// AudioContext requests 16 kHz. Resample explicitly if the device chooses another rate.
class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = [];
    this.position = 0;
  }
  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    const step = sampleRate / 16000;
    for (; this.position < input.length; this.position += step) {
      const v = input[Math.floor(this.position)] ?? 0;
      this.samples.push(Math.round(Math.max(-1, Math.min(1, v)) * 32767));
    }
    this.position -= input.length;
    if (this.samples.length >= 1600) {
      this.port.postMessage(Int16Array.from(this.samples.splice(0, 1600)));
    }
    return true;
  }
}
registerProcessor("kaling-pcm", PCMProcessor);
