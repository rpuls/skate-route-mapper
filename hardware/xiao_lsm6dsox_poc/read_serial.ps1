param(
  [string]$PortName = "COM3",
  [int]$BaudRate = 115200,
  [int]$Seconds = 10
)

$port = New-Object System.IO.Ports.SerialPort $PortName, $BaudRate, "None", 8, "One"
$port.ReadTimeout = 1000
$port.DtrEnable = $true
$port.RtsEnable = $false

try {
  $port.Open()
  Start-Sleep -Milliseconds 500

  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    try {
      Write-Output $port.ReadLine()
    } catch [TimeoutException] {
    }
  }
} finally {
  if ($port.IsOpen) {
    $port.Close()
  }
}
