export class CallDetector {
  private audioCtx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private vbStream: MediaStream | null = null
  private intervalId: ReturnType<typeof setInterval> | null = null
  private silenceTimer = 0

  /**
   * Opens VB-Cable in listen-only mode (no MediaRecorder).
   * Polls audio levels every 300 ms.
   *   avg > 10  → onCallDetected (first time)
   *   8 s silence → onCallEnded
   */
  async startListening(
    onCallDetected: () => void,
    onCallEnded: () => void,
  ): Promise<void> {
    const devices = await navigator.mediaDevices.enumerateDevices()
    const vbCable = devices
      .filter((d) => d.kind === 'audioinput')
      .find(
        (d) =>
          d.label.toLowerCase().includes('cable') ||
          d.label.toLowerCase().includes('vb-audio'),
      )

    this.vbStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: vbCable ? { exact: vbCable.deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    })

    this.audioCtx = new AudioContext()
    this.analyser = this.audioCtx.createAnalyser()
    this.analyser.fftSize = 256
    this.audioCtx.createMediaStreamSource(this.vbStream).connect(this.analyser)

    let callActive = false
    const dataArray = new Uint8Array(this.analyser.frequencyBinCount)

    this.intervalId = setInterval(() => {
      if (!this.analyser) return
      this.analyser.getByteFrequencyData(dataArray)
      const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length

      if (avg > 10) {
        // Audio present → call is active
        this.silenceTimer = 0
        if (!callActive) {
          callActive = true
          onCallDetected()
        }
      } else if (callActive) {
        // Silence while call was active → count down
        this.silenceTimer += 300
        if (this.silenceTimer > 8000) {
          callActive = false
          this.silenceTimer = 0
          onCallEnded()
        }
      }
    }, 300)
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    this.vbStream?.getTracks().forEach((t) => t.stop())
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      this.audioCtx.close()
    }
    this.audioCtx = null
    this.analyser = null
    this.vbStream = null
    this.silenceTimer = 0
  }
}
