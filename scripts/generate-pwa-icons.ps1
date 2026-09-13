<#
  Generates the parent PWA's required icon set from the master clinic logo.
  Master source lives at apps/mobile/branding/clinic-logo-source.png (square,
  >= 1024x1024). Outputs go to apps/mobile/public per
  docs/parent-pwa-deployment.md "Required brand asset gate".
#>
param(
  [string]$Source = "D:\Study\Shimaa-tlal-app\apps\mobile\branding\clinic-logo-source.png",
  [string]$OutDir = "D:\Study\Shimaa-tlal-app\apps\mobile\public"
)

Add-Type -AssemblyName System.Drawing

function New-ResizedPng {
  param(
    [System.Drawing.Image]$SourceImage,
    [int]$Size,
    [string]$OutPath
  )
  $bmp = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.DrawImage($SourceImage, 0, 0, $Size, $Size)
  $g.Dispose()
  $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

function New-MaskablePng {
  param(
    [System.Drawing.Image]$SourceImage,
    [int]$Size,
    [System.Drawing.Color]$BackgroundColor,
    [double]$SafeZoneFraction,
    [string]$OutPath
  )
  $bmp = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $brush = New-Object System.Drawing.SolidBrush($BackgroundColor)
  $g.FillRectangle($brush, 0, 0, $Size, $Size)
  $inner = [int]([math]::Round($Size * $SafeZoneFraction))
  $offset = [int]([math]::Round(($Size - $inner) / 2))
  $g.DrawImage($SourceImage, $offset, $offset, $inner, $inner)
  $brush.Dispose()
  $g.Dispose()
  $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

if (-not (Test-Path $Source)) {
  throw "Master logo not found at $Source"
}

$src = [System.Drawing.Image]::FromFile($Source)
if ($src.Width -lt 1024 -or $src.Height -lt 1024 -or $src.Width -ne $src.Height) {
  throw "Source logo must be square and at least 1024x1024, got $($src.Width)x$($src.Height)"
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

# background_color from apps/mobile/src/app/pwa/pwa.config.mts
$bg = [System.Drawing.Color]::FromArgb(255, 0xFF, 0xF4, 0xEC)

New-ResizedPng -SourceImage $src -Size 192 -OutPath (Join-Path $OutDir "pwa-192x192.png")
New-ResizedPng -SourceImage $src -Size 512 -OutPath (Join-Path $OutDir "pwa-512x512.png")
New-MaskablePng -SourceImage $src -Size 512 -BackgroundColor $bg -SafeZoneFraction 0.7 -OutPath (Join-Path $OutDir "pwa-maskable-512x512.png")
New-ResizedPng -SourceImage $src -Size 180 -OutPath (Join-Path $OutDir "apple-touch-icon.png")

$src.Dispose()

Write-Output "Generated icons in $OutDir"
