Add-Type -AssemblyName System.Drawing

function New-AppIcon {
    param(
        [int]$Size,
        [string]$OutPath
    )

    $bmp = New-Object System.Drawing.Bitmap $Size, $Size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias

    # Background: rounded square, brand color gradient
    $colorTop = [System.Drawing.Color]::FromArgb(255, 15, 76, 92)     # #0F4C5C
    $colorBottom = [System.Drawing.Color]::FromArgb(255, 10, 53, 64)  # #0A3540
    $rect = New-Object System.Drawing.Rectangle 0, 0, $Size, $Size
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $colorTop, $colorBottom, 45)
    $radius = [int]($Size * 0.18)

    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $radius * 2
    $path.AddArc(0, 0, $d, $d, 180, 90)
    $path.AddArc($Size - $d, 0, $d, $d, 270, 90)
    $path.AddArc($Size - $d, $Size - $d, $d, $d, 0, 90)
    $path.AddArc(0, $Size - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    $g.FillPath($brush, $path)

    # Accent bar
    $accentBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 23, 166, 114))
    $barHeight = [int]($Size * 0.09)
    $g.FillRectangle($accentBrush, 0, $Size - $barHeight - [int]($Size*0.02), $Size, $barHeight)

    # Main text "116"
    $fontSize = [single]([int]($Size * 0.34))
    $font = [System.Drawing.Font]::new("Segoe UI", $fontSize, [System.Drawing.FontStyle]::Bold)
    $textBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    $textRect = New-Object System.Drawing.RectangleF 0, ($Size * -0.06), $Size, $Size
    $g.DrawString("116", $font, $textBrush, $textRect, $sf)

    # Small label "PSAK" above
    $labelFontSize = [single]([int]($Size * 0.11))
    $labelFont = [System.Drawing.Font]::new("Segoe UI", $labelFontSize, [System.Drawing.FontStyle]::Bold)
    $labelRect = New-Object System.Drawing.RectangleF 0, ($Size * 0.10), $Size, ($Size * 0.2)
    $labelBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 200, 230, 224))
    $g.DrawString("PSAK", $labelFont, $labelBrush, $labelRect, $sf)

    $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
    Write-Host "Created $OutPath ($Size x $Size)"
}

$iconDir = Join-Path $PSScriptRoot "icons"
if (-not (Test-Path $iconDir)) { New-Item -ItemType Directory -Path $iconDir | Out-Null }

New-AppIcon -Size 192 -OutPath (Join-Path $iconDir "icon-192.png")
New-AppIcon -Size 512 -OutPath (Join-Path $iconDir "icon-512.png")
