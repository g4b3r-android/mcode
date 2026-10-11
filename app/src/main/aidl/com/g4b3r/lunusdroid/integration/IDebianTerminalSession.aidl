package com.g4b3r.lunusdroid.integration;

/**
 * Handle to a continuous Debian terminal session.
 */
interface IDebianTerminalSession {
    /** Sends input data to the terminal. */
    void write(in byte[] data);

    /** Resizes the terminal PTY. */
    void resize(int rows, int cols);

    /** Closes the terminal session and kills the process. */
    void close();
}
