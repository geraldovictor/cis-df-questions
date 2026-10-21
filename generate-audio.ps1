$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
$speaker.SelectVoice('Microsoft Zira Desktop')
$speaker.Rate = -1
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$files = @('questoes-1-corrigida (1).json', 'questoes-2-corrigida-v2 (1).json', 'questoes-3-corrigida-v2 (1).json')
$folder = Join-Path $PSScriptRoot 'audio'
New-Item -ItemType Directory -Force -Path $folder | Out-Null
try {
  for ($f = 0; $f -lt $files.Count; $f++) {
    $questions = Get-Content -LiteralPath (Join-Path $PSScriptRoot $files[$f]) -Raw -Encoding UTF8 | ConvertFrom-Json
    for ($i = 0; $i -lt $questions.Count; $i++) {
      $id = '{0}-{1}' -f ($f + 1), ($i + 1)
      $question = $questions[$i]
      $answers = @($question.alternativas | Where-Object { $_.correta } | ForEach-Object { $_.texto })
      $text = 'Question. ' + ($question.pergunta -replace '(?<=[a-z?])\.(?=[A-Z])', '. ') + '. Correct answer. ' + ($answers -join '. ') + '.'
      $speaker.SetOutputToWaveFile((Join-Path $folder "$id.wav"), $format)
      $speaker.Speak($text)
      $speaker.SetOutputToNull()
    }
    Write-Output "Generated set $($f + 1): $($questions.Count) recordings"
  }
} finally { $speaker.Dispose() }
