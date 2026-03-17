export interface CaptureResult {
  mixedStream: MediaStream
  customerStream: MediaStream
  agentStream: MediaStream
  audioCtx: AudioContext
  deviceLabels: { customer: string; agent: string }
}

export async function startMicroSIPCapture(): Promise<CaptureResult> {
  const devices = await navigator.mediaDevices.enumerateDevices()
  const audioInputs = devices.filter((d) => d.kind === 'audioinput')

  // VB-Cable = MicroSIP speaker output (customer voice)
  const vbCable = audioInputs.find(
    (d) =>
      d.label.toLowerCase().includes('cable') ||
      d.label.toLowerCase().includes('vb-audio')
  )

  // Real mic = agent headset
  const realMic = audioInputs.find(
    (d) =>
      d.deviceId !== 'default' &&
      !d.label.toLowerCase().includes('cable') &&
      !d.label.toLowerCase().includes('vb-audio')
  )

  const customerStream = await navigator.mediaDevices.getUserMedia({
    audio: { deviceId: vbCable ? { exact: vbCable.deviceId } : 'default' },
  })

  const agentStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: realMic ? { exact: realMic.deviceId } : 'default',
      echoCancellation: true,
      noiseSuppression: true,
    },
  })

  const audioCtx = new AudioContext()
  const destination = audioCtx.createMediaStreamDestination()
  audioCtx.createMediaStreamSource(customerStream).connect(destination)
  audioCtx.createMediaStreamSource(agentStream).connect(destination)

  return {
    mixedStream: destination.stream,
    customerStream,
    agentStream,
    audioCtx,
    deviceLabels: {
      customer: vbCable?.label ?? 'Default (no VB-Cable found)',
      agent: realMic?.label ?? 'Default mic',
    },
  }
}

export function stopCapture(result: CaptureResult) {
  result.customerStream.getTracks().forEach((t) => t.stop())
  result.agentStream.getTracks().forEach((t) => t.stop())
  result.audioCtx.close()
}
