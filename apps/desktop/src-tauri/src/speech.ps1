$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
function Emit($value) { [Console]::Out.WriteLine(($value | ConvertTo-Json -Compress -Depth 8)); [Console]::Out.Flush() }
try {
  Add-Type -AssemblyName System.Speech
  if ($env:KALING_MODE -eq 'clips') {
    $texts = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
    $voice = $synth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -like 'zh-*' } | Select-Object -First 1
    if (-not $voice) { throw 'Install a Chinese Windows text-to-speech voice in Language settings.' }
    $synth.SelectVoice($voice.VoiceInfo.Name)
    $synth.Rate = 3
    $result = @{}
    foreach ($item in $texts.PSObject.Properties) {
      $stream = New-Object System.IO.MemoryStream
      $synth.SetOutputToWaveStream($stream)
      $synth.Speak([string]$item.Value)
      $synth.SetOutputToNull()
      $result[$item.Name] = [Convert]::ToBase64String($stream.ToArray())
      $stream.Dispose()
    }
    $synth.Dispose()
    Emit $result
    exit 0
  }
  $phrases = Get-Content -LiteralPath $env:KALING_GRAMMAR -Raw -Encoding UTF8 | ConvertFrom-Json
  $info = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() | Where-Object { $_.Culture.Name -eq 'zh-CN' } | Select-Object -First 1
  if (-not $info) { throw 'Install the zh-CN Windows desktop speech recognizer (System.Speech).' }
  $engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine($info)
  $choices = New-Object System.Speech.Recognition.Choices
  $choices.Add([string[]]$phrases)
  $builder = New-Object System.Speech.Recognition.GrammarBuilder
  $builder.Culture = $info.Culture
  $builder.Append($choices)
  $engine.LoadGrammar((New-Object System.Speech.Recognition.Grammar($builder)))
  $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
  # SAPI queries Length and Position even for a live, forward-only PCM stream.
  # Console's pipe throws for these properties; track bytes without retaining audio.
  Add-Type -TypeDefinition @'
using System;
using System.IO;
public sealed class KalingPcmStream : Stream {
  private readonly Stream input;
  private long position;
  public KalingPcmStream(Stream input) { this.input = input; }
  public override bool CanRead { get { return true; } }
  public override bool CanSeek { get { return false; } }
  public override bool CanWrite { get { return false; } }
  public override long Length { get { return long.MaxValue; } }
  public override long Position {
    get { return position; }
    set { Seek(value, SeekOrigin.Begin); }
  }
  public override int Read(byte[] buffer, int offset, int count) {
    // COM treats a short read as end-of-stream; pipe chunks are not EOF.
    int total = 0;
    while (total < count) {
      int read = input.Read(buffer, offset + total, count - total);
      if (read == 0) break;
      position += read;
      total += read;
    }
    return total;
  }
  public override long Seek(long offset, SeekOrigin origin) {
    if ((origin == SeekOrigin.Current && offset == 0) ||
        (origin == SeekOrigin.Begin && offset == position)) return position;
    throw new NotSupportedException("Live PCM cannot be rewound.");
  }
  public override void Flush() { }
  public override void SetLength(long value) { throw new NotSupportedException(); }
  public override void Write(byte[] buffer, int offset, int count) { throw new NotSupportedException(); }
  protected override void Dispose(bool disposing) {
    if (disposing) input.Dispose();
    base.Dispose(disposing);
  }
}
'@
  $pcmStream = New-Object KalingPcmStream([Console]::OpenStandardInput())
  $engine.SetInputToAudioStream($pcmStream, $format)
  Register-ObjectEvent -InputObject $engine -EventName SpeechRecognized -SourceIdentifier KalingRecognized | Out-Null
  Register-ObjectEvent -InputObject $engine -EventName SpeechRecognitionRejected -SourceIdentifier KalingRejected | Out-Null
  Register-ObjectEvent -InputObject $engine -EventName RecognizeCompleted -SourceIdentifier KalingCompleted | Out-Null
  $started = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  Emit @{ kind = 'ready' }
  $engine.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
  while ($true) {
    $event = Wait-Event
    if ($event.SourceIdentifier -eq 'KalingCompleted') { break }
    if ($event.SourceIdentifier -eq 'KalingRejected') { Emit @{ kind = 'rejected' } }
    if ($event.SourceIdentifier -eq 'KalingRecognized') {
      $r = $event.SourceEventArgs.Result
      $onset = $null
      if ($r.Audio) { $onset = $started + [long]$r.Audio.AudioPosition.TotalMilliseconds }
      Emit @{ kind = 'result'; id = [Guid]::NewGuid().ToString(); text = $r.Text; confidence = $r.Confidence; onsetAt = $onset; recognizedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
    }
    Remove-Event -EventIdentifier $event.EventIdentifier
  }
  $engine.Dispose()
} catch {
  Emit @{ kind = 'error'; message = $_.Exception.Message }
  exit 1
}
