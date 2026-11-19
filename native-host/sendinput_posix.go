//go:build !windows

package main

import "sync"

// PosixAuditDispatcher records hardware pointer trajectories safely when compiled
// on non-Windows hosts (e.g., Linux CI runners verifying protocol framing & timing).
type PosixAuditDispatcher struct {
	mu     sync.Mutex
	Events []InputWaypoint
}

func NewPlatformMouseDispatcher() MouseDispatcher {
	return &PosixAuditDispatcher{}
}

func (d *PosixAuditDispatcher) IsSimulated() bool {
	return true
}

func (d *PosixAuditDispatcher) DispatchMouseEvent(wp InputWaypoint) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.Events = append(d.Events, wp)
	return nil
}
