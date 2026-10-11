package com.g4b3r.lunusdroid.integration;

import android.os.Bundle;
import com.g4b3r.lunusdroid.integration.IDebianTerminalCallback;
import com.g4b3r.lunusdroid.integration.IDebianTerminalSession;

/**
 * Executes one non-interactive command in LunusDroid's Debian rootfs.
 * Calls can block until the command exits and must never be made from a client UI thread.
 */
interface IDebianCommandService {
    Bundle execute(String command, String workingDirectory);

    /**
     * Creates a continuous terminal session (interactive shell).
     */
    IDebianTerminalSession createTerminalSession(IDebianTerminalCallback callback, int rows, int cols);
}
