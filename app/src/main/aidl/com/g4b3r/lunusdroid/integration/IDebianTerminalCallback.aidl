package com.g4b3r.lunusdroid.integration;

/**
 * Callback for receiving output and state from a continuous Debian terminal session.
 */
interface IDebianTerminalCallback {
    /** Called when the terminal produces output. */
    void onOutput(in byte[] data);

    /** Called when the terminal process exits. */
    void onSessionClosed(int exitCode);
}
