package main

import (
	"bytes"
	"testing"
	"time"
)

type recordingDispatcher struct {
	events []InputWaypoint
}

func (r *recordingDispatcher) DispatchMouseEvent(wp InputWaypoint) error {
	r.events = append(r.events, wp)
	return nil
}

func (r *recordingDispatcher) IsSimulated() bool {
	return true
}

func TestNativeHostDefaultsDisabled(t *testing.T) {
	cfg := DefaultHostConfig()
	if cfg.Enabled {
		t.Fatal("expected DefaultHostConfig().Enabled to default to false")
	}

	req := InputBatchRequest{
		Type:    "DISPATCH_TRAJECTORY",
		Enabled: false,
		BatchID: "b-disabled",
		Mode:    "drag",
		Waypoints: []InputWaypoint{
			{X: 100, Y: 100, DelayMs: 0, Action: ActionMove},
		},
	}
	rec := &recordingDispatcher{}
	resp := ProcessBatchRequest(req, cfg, rec)
	if resp.OK || resp.Error != "NATIVE_HOST_DISABLED" {
		t.Fatalf("expected NATIVE_HOST_DISABLED, got %+v", resp)
	}
	if len(rec.events) != 0 {
		t.Fatalf("expected 0 dispatched events when disabled, got %d", len(rec.events))
	}
}

func TestNativeMessagingBinaryFrameRoundtrip(t *testing.T) {
	req := InputBatchRequest{
		Type:            "DISPATCH_TRAJECTORY",
		Enabled:         true,
		BatchID:         "b-roundtrip",
		Mode:            "drag",
		CoordinateSpace: "screen_px",
		Waypoints: []InputWaypoint{
			{X: 420, Y: 620, DelayMs: 0, Action: ActionMove},
			{X: 420, Y: 620, DelayMs: 4, Action: ActionLeftDown},
			{X: 422, Y: 540, DelayMs: 16, Action: ActionMove},
			{X: 425, Y: 480, DelayMs: 16, Action: ActionMove},
			{X: 425, Y: 480, DelayMs: 4, Action: ActionLeftUp},
		},
	}

	var inBuf bytes.Buffer
	if err := WriteNativeMessage(&inBuf, req); err != nil {
		t.Fatalf("WriteNativeMessage failed: %v", err)
	}

	var outBuf bytes.Buffer
	var sleptTotal time.Duration
	cfg := HostConfig{
		Enabled: true,
		SleepFn: func(d time.Duration) {
			sleptTotal += d
		},
	}
	rec := &recordingDispatcher{}

	if err := RunNativeLoop(&inBuf, &outBuf, cfg, rec); err != nil {
		t.Fatalf("RunNativeLoop failed: %v", err)
	}

	rawResp, err := ReadNativeMessage(&outBuf)
	if err != nil {
		t.Fatalf("ReadNativeMessage failed: %v", err)
	}
	if !bytes.Contains(rawResp, []byte(`"ok":true`)) || !bytes.Contains(rawResp, []byte(`"dispatchedEvents":5`)) {
		t.Fatalf("unexpected response JSON: %s", string(rawResp))
	}
	if len(rec.events) != 5 {
		t.Fatalf("expected 5 recorded waypoints, got %d", len(rec.events))
	}
	if sleptTotal != 40*time.Millisecond {
		t.Fatalf("expected 40ms total sleep, got %v", sleptTotal)
	}
}
