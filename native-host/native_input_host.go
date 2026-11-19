// ChessForge Native Messaging Input Host (`native_input_host.go`).
//
// Reads 4-byte little-endian length-prefixed JSON waypoint batches emitted by
// `NativeMessagingInputDriver` over stdin (Chrome Native Messaging protocol) and
// dispatches OS-level hardware mouse trajectories via Windows `SendInput()`
// (`MOUSEEVENTF_MOVE`, `MOUSEEVENTF_ABSOLUTE`, `MOUSEEVENTF_LEFTDOWN`, `MOUSEEVENTF_LEFTUP`).
//
// Defaults to disabled unless explicitly enabled (`--enable` flag or explicit opt-in
// `enabled: true` in the trajectory batch).

package main

import (
	"bufio"
	"encoding/binary"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"math"
	"os"
	"time"
)

const (
	MaxNativeMessageBytes = 1024 * 1024
	MaxWaypointsPerBatch  = 512
	MaxStepDelayMs        = 2000
)

type WaypointAction string

const (
	ActionMove     WaypointAction = "move"
	ActionLeftDown WaypointAction = "left_down"
	ActionLeftUp   WaypointAction = "left_up"
)

type InputWaypoint struct {
	X       float64        `json:"x"`
	Y       float64        `json:"y"`
	DelayMs int            `json:"delayMs"`
	Action  WaypointAction `json:"action"`
}

type InputBatchRequest struct {
	Type            string          `json:"type"`
	Enabled         bool            `json:"enabled"`
	BatchID         string          `json:"batchId"`
	Mode            string          `json:"mode"`
	CoordinateSpace string          `json:"coordinateSpace"`
	Waypoints       []InputWaypoint `json:"waypoints"`
}

type InputBatchResponse struct {
	OK               bool   `json:"ok"`
	BatchID          string `json:"batchId"`
	DispatchedEvents int    `json:"dispatchedEvents"`
	Simulated        bool   `json:"simulated,omitempty"`
	Error            string `json:"error,omitempty"`
}

// MouseDispatcher abstracts OS pointer injection so Windows SendInput and
// cross-platform verification runners share identical validation and timing.
type MouseDispatcher interface {
	DispatchMouseEvent(wp InputWaypoint) error
	IsSimulated() bool
}

type HostConfig struct {
	// Explicit opt-in flag; defaults to false to prevent unintentional OS pointer control.
	Enabled bool
	DryRun  bool
	SleepFn func(d time.Duration)
}

func DefaultHostConfig() HostConfig {
	return HostConfig{
		Enabled: false,
		DryRun:  false,
		SleepFn: time.Sleep,
	}
}

func ReadNativeMessage(r io.Reader) ([]byte, error) {
	var lengthBuf [4]byte
	if _, err := io.ReadFull(r, lengthBuf[:]); err != nil {
		return nil, err
	}
	msgLen := binary.LittleEndian.Uint32(lengthBuf[:])
	if msgLen == 0 {
		return nil, errors.New("empty native message frame")
	}
	if msgLen > MaxNativeMessageBytes {
		return nil, fmt.Errorf("native message length %d exceeds max %d", msgLen, MaxNativeMessageBytes)
	}
	payload := make([]byte, msgLen)
	if _, err := io.ReadFull(r, payload); err != nil {
		return nil, err
	}
	return payload, nil
}

func WriteNativeMessage(w io.Writer, v any) error {
	payload, err := json.Marshal(v)
	if err != nil {
		return err
	}
	if len(payload) > MaxNativeMessageBytes {
		return fmt.Errorf("outgoing payload size %d exceeds max %d", len(payload), MaxNativeMessageBytes)
	}
	var lengthBuf [4]byte
	binary.LittleEndian.PutUint32(lengthBuf[:], uint32(len(payload)))
	if _, err := w.Write(lengthBuf[:]); err != nil {
		return err
	}
	_, err = w.Write(payload)
	return err
}

func ValidateBatchRequest(req InputBatchRequest) error {
	if req.Type != "DISPATCH_TRAJECTORY" {
		return fmt.Errorf("unsupported message type %q", req.Type)
	}
	if len(req.Waypoints) == 0 {
		return errors.New("batch contains zero waypoints")
	}
	if len(req.Waypoints) > MaxWaypointsPerBatch {
		return fmt.Errorf("waypoint count %d exceeds limit %d", len(req.Waypoints), MaxWaypointsPerBatch)
	}
	for i, wp := range req.Waypoints {
		if math.IsNaN(wp.X) || math.IsInf(wp.X, 0) || math.IsNaN(wp.Y) || math.IsInf(wp.Y, 0) {
			return fmt.Errorf("waypoint %d has non-finite coordinates", i)
		}
		if wp.X < -32768 || wp.X > 32768 || wp.Y < -32768 || wp.Y > 32768 {
			return fmt.Errorf("waypoint %d coordinates out of virtual desktop bounds", i)
		}
		switch wp.Action {
		case ActionMove, ActionLeftDown, ActionLeftUp:
		default:
			return fmt.Errorf("waypoint %d has invalid action %q", i, wp.Action)
		}
	}
	return nil
}

func ProcessBatchRequest(
	req InputBatchRequest,
	cfg HostConfig,
	dispatcher MouseDispatcher,
) InputBatchResponse {
	if !cfg.Enabled && !req.Enabled {
		return InputBatchResponse{
			OK:      false,
			BatchID: req.BatchID,
			Error:   "NATIVE_HOST_DISABLED",
		}
	}

	if err := ValidateBatchRequest(req); err != nil {
		return InputBatchResponse{
			OK:      false,
			BatchID: req.BatchID,
			Error:   err.Error(),
		}
	}

	sleepFn := cfg.SleepFn
	if sleepFn == nil {
		sleepFn = time.Sleep
	}

	dispatched := 0
	for _, wp := range req.Waypoints {
		delayMs := wp.DelayMs
		if delayMs < 0 {
			delayMs = 0
		} else if delayMs > MaxStepDelayMs {
			delayMs = MaxStepDelayMs
		}
		if delayMs > 0 {
			sleepFn(time.Duration(delayMs) * time.Millisecond)
		}
		if !cfg.DryRun {
			if err := dispatcher.DispatchMouseEvent(wp); err != nil {
				return InputBatchResponse{
					OK:               false,
					BatchID:          req.BatchID,
					DispatchedEvents: dispatched,
					Simulated:        dispatcher.IsSimulated(),
					Error:            err.Error(),
				}
			}
		}
		dispatched++
	}

	return InputBatchResponse{
		OK:               true,
		BatchID:          req.BatchID,
		DispatchedEvents: dispatched,
		Simulated:        cfg.DryRun || dispatcher.IsSimulated(),
	}
}

func RunNativeLoop(r io.Reader, w io.Writer, cfg HostConfig, dispatcher MouseDispatcher) error {
	for {
		raw, err := ReadNativeMessage(r)
		if err != nil {
			if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
				return nil
			}
			return err
		}
		var req InputBatchRequest
		if err := json.Unmarshal(raw, &req); err != nil {
			_ = WriteNativeMessage(w, InputBatchResponse{
				OK:    false,
				Error: fmt.Sprintf("invalid JSON: %v", err),
			})
			continue
		}
		resp := ProcessBatchRequest(req, cfg, dispatcher)
		if err := WriteNativeMessage(w, resp); err != nil {
			return err
		}
	}
}

func RunNdjsonLoop(r io.Reader, w io.Writer, cfg HostConfig, dispatcher MouseDispatcher) error {
	scanner := bufio.NewScanner(r)
	buf := make([]byte, 0, 64*1024)
	scanner.Buffer(buf, MaxNativeMessageBytes)
	enc := json.NewEncoder(w)

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		var req InputBatchRequest
		if err := json.Unmarshal(line, &req); err != nil {
			if err := enc.Encode(InputBatchResponse{
				OK:    false,
				Error: fmt.Sprintf("invalid JSON: %v", err),
			}); err != nil {
				return err
			}
			continue
		}
		resp := ProcessBatchRequest(req, cfg, dispatcher)
		if err := enc.Encode(resp); err != nil {
			return err
		}
	}
	return scanner.Err()
}

func main() {
	enableFlag := flag.Bool("enable", false, "Explicitly opt in to dispatching input batches")
	dryRunFlag := flag.Bool("dry-run", false, "Validate and time batches without invoking OS pointer APIs")
	ndjsonFlag := flag.Bool("ndjson", false, "Use newline-delimited JSON instead of 4-byte Chrome native messaging frames")
	flag.Parse()

	cfg := DefaultHostConfig()
	cfg.Enabled = *enableFlag
	cfg.DryRun = *dryRunFlag

	dispatcher := NewPlatformMouseDispatcher()

	var err error
	if *ndjsonFlag {
		err = RunNdjsonLoop(os.Stdin, os.Stdout, cfg, dispatcher)
	} else {
		err = RunNativeLoop(os.Stdin, os.Stdout, cfg, dispatcher)
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "chessforge-native-input-host: %v\n", err)
		os.Exit(1)
	}
}
