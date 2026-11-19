//go:build windows

package main

import (
	"fmt"
	"math"
	"syscall"
	"unsafe"
)

const (
	inputMouse             = 0
	mouseEventfMove        = 0x0001
	mouseEventfLeftDown    = 0x0002
	mouseEventfLeftUp      = 0x0004
	mouseEventfVirtualDesk = 0x4000
	mouseEventfAbsolute    = 0x8000

	smXVirtualScreen  = 76
	smYVirtualScreen  = 77
	smCXVirtualScreen = 78
	smCYVirtualScreen = 79
)

var (
	user32               = syscall.NewLazyDLL("user32.dll")
	procSendInput        = user32.NewProc("SendInput")
	procGetSystemMetrics = user32.NewProc("GetSystemMetrics")
)

type mouseInput struct {
	dx          int32
	dy          int32
	mouseData   uint32
	dwFlags     uint32
	time        uint32
	dwExtraInfo uintptr
}

// win32Input matches Windows tagINPUT (type + union padded to MOUSEINPUT layout).
type win32Input struct {
	inputType uint32
	_         uint32
	mi        mouseInput
}

type WindowsSendInputDispatcher struct{}

func NewPlatformMouseDispatcher() MouseDispatcher {
	return &WindowsSendInputDispatcher{}
}

func (d *WindowsSendInputDispatcher) IsSimulated() bool {
	return false
}

func getSystemMetric(index int) int {
	v, _, _ := procGetSystemMetrics.Call(uintptr(index))
	return int(int32(v))
}

func normalizeVirtualScreenCoord(x, y float64) (int32, int32) {
	vx := getSystemMetric(smXVirtualScreen)
	vy := getSystemMetric(smYVirtualScreen)
	vw := getSystemMetric(smCXVirtualScreen)
	vh := getSystemMetric(smCYVirtualScreen)
	if vw <= 1 {
		vw = 1920
	}
	if vh <= 1 {
		vh = 1080
	}

	nx := math.Round(((x - float64(vx)) * 65535.0) / float64(vw-1))
	ny := math.Round(((y - float64(vy)) * 65535.0) / float64(vh-1))

	if nx < 0 {
		nx = 0
	} else if nx > 65535 {
		nx = 65535
	}
	if ny < 0 {
		ny = 0
	} else if ny > 65535 {
		ny = 65535
	}
	return int32(nx), int32(ny)
}

func (d *WindowsSendInputDispatcher) DispatchMouseEvent(wp InputWaypoint) error {
	absX, absY := normalizeVirtualScreenCoord(wp.X, wp.Y)
	var flags uint32 = mouseEventfMove | mouseEventfAbsolute | mouseEventfVirtualDesk

	switch wp.Action {
	case ActionMove:
		// Move only
	case ActionLeftDown:
		flags |= mouseEventfLeftDown
	case ActionLeftUp:
		flags |= mouseEventfLeftUp
	default:
		return fmt.Errorf("unsupported action %q", wp.Action)
	}

	in := win32Input{
		inputType: inputMouse,
		mi: mouseInput{
			dx:      absX,
			dy:      absY,
			dwFlags: flags,
		},
	}

	sent, _, callErr := procSendInput.Call(
		uintptr(1),
		uintptr(unsafe.Pointer(&in)),
		unsafe.Sizeof(in),
	)
	if sent != 1 {
		return fmt.Errorf("SendInput failed (sent=%d, err=%v)", sent, callErr)
	}
	return nil
}
