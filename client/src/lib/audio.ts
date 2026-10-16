export async function convertAudioToWav(recording: Blob): Promise<Blob> {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await recording.arrayBuffer());
    const sampleRate = 16000;
    const sourceLength = decoded.length;
    const outputLength = Math.ceil(sourceLength * sampleRate / decoded.sampleRate);
    const pcm = new Int16Array(outputLength);

    for (let index = 0; index < outputLength; index += 1) {
      const sourcePosition = index * decoded.sampleRate / sampleRate;
      const leftIndex = Math.floor(sourcePosition);
      const rightIndex = Math.min(leftIndex + 1, sourceLength - 1);
      const ratio = sourcePosition - leftIndex;
      let sample = 0;
      for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
        const data = decoded.getChannelData(channel);
        sample += data[leftIndex] * (1 - ratio) + data[rightIndex] * ratio;
      }
      sample /= decoded.numberOfChannels;
      const clamped = Math.max(-1, Math.min(1, sample));
      pcm[index] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    }

    const header = new ArrayBuffer(44);
    const view = new DataView(header);
    writeAscii(view, 0, "RIFF");
    view.setUint32(4, 36 + pcm.byteLength, true);
    writeAscii(view, 8, "WAVE");
    writeAscii(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeAscii(view, 36, "data");
    view.setUint32(40, pcm.byteLength, true);
    return new Blob([header, pcm], { type: "audio/wav" });
  } finally {
    await context.close();
  }
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}
