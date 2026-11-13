param(
  [string]$Source = 'D:\Urban Defence Ref\Units',
  [string]$Output = (Join-Path $PSScriptRoot '..\assets\unit-reference.js'),
  [string]$Manifest = (Join-Path $PSScriptRoot '..\assets\unit-reference.manifest.json'),
  [string]$Symbol = 'PIXEL_UNIT_REFERENCE'
)
$ErrorActionPreference = 'Stop'
$config = Get-Content -LiteralPath $Manifest -Raw | ConvertFrom-Json
if ($config.version -ne 1 -or [string]::IsNullOrWhiteSpace($config.id) -or
    $config.nativeFacing -notin @(-1, 1) -or
    ($null -ne $config.tintColor -and $config.tintColor -notmatch '^#[0-9a-fA-F]{6}$') -or
    $Symbol -cnotmatch '^[A-Z][A-Z0-9_]*$' -or !$config.clips) { throw 'Invalid unit asset manifest or output symbol (use an uppercase constant name)' }
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public static class UnitReferencePixels {
  public static int[] Read(Image image) {
    bool direct = image is Bitmap && image.RawFormat.Guid == ImageFormat.Png.Guid && image.PixelFormat == PixelFormat.Format32bppArgb;
    using (var bitmap = direct ? (Bitmap)((Bitmap)image).Clone() : new Bitmap(image.Width, image.Height, PixelFormat.Format32bppArgb)) {
      if (!direct) using (var graphics = Graphics.FromImage(bitmap)) graphics.DrawImageUnscaled(image, 0, 0);
      var data = bitmap.LockBits(new Rectangle(0, 0, bitmap.Width, bitmap.Height), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
      try {
        var pixels = new int[bitmap.Width * bitmap.Height];
        for (int y = 0; y < bitmap.Height; y++) Marshal.Copy(IntPtr.Add(data.Scan0, y * data.Stride), pixels, y * bitmap.Width, bitmap.Width);
        for (int i = 0; i < pixels.Length; i++) if ((uint)pixels[i] >> 24 == 0) pixels[i] = 0;
        return pixels;
      } finally { bitmap.UnlockBits(data); }
    }
  }
  public static int Gcd(int a, int b) { while (b != 0) { int t = a % b; a = b; b = t; } return a; }
  public static int Grid(int[] pixels, int width, int height) {
    int grid = Gcd(width, height);
    for (int y = 0; y < height; y++) for (int x = 1; x < width; x++)
      if (pixels[y * width + x] != pixels[y * width + x - 1]) grid = Gcd(grid, x);
    for (int y = 1; y < height; y++) for (int x = 0; x < width; x++)
      if (pixels[y * width + x] != pixels[(y - 1) * width + x]) grid = Gcd(grid, y);
    return grid;
  }
  public static object[] Runs(int[] pixels, int width, int height, int grid) {
    var runs = new List<object>();
    for (int y = 0; y < height; y++) for (int x = 0; x < width; x++)
      if (pixels[y * width + x] != pixels[(y / grid * grid) * width + x / grid * grid])
        throw new InvalidOperationException("Pixel grid would lose source artwork detail");
    for (int y = 0; y < height; y += grid) {
      for (int x = 0; x < width;) {
        int color = pixels[y * width + x], end = x + grid;
        while (end < width && pixels[y * width + end] == color) end += grid;
        if (color != 0) runs.Add(new object[] { x / grid, y / grid, (end - x) / grid, color });
        x = end;
      }
    }
    return runs.ToArray();
  }
}
'@
$result = [ordered]@{ version = 1; id = $config.id; source = $config.source
  nativeFacing = $config.nativeFacing; tintColor = $config.tintColor; clips = [ordered]@{} }
if ($null -ne $config.footRow) { $result.footRow = $config.footRow }
foreach ($property in $config.clips.PSObject.Properties) {
  $name = $property.Name
  $items = @($property.Value)
  $rawFrames = @()
  $grid = 0
  $width = 0; $height = 0; $sources = @()
  foreach ($item in $items) {
    $file = if ($item -is [string]) { $item } else { $item.file }
    $path = Join-Path $Source $file
    $image = [System.Drawing.Image]::FromFile($path)
    try {
      if ($width -ne 0 -and ($image.Width -ne $width -or $image.Height -ne $height)) {
        throw "Reference '$name' PNG/GIF sequence must share the same padded canvas"
      }
      $width = $image.Width; $height = $image.Height
      $dimension = New-Object System.Drawing.Imaging.FrameDimension($image.FrameDimensionsList[0])
      $count = $image.GetFrameCount($dimension)
      $delays = if ($image.PropertyIdList -contains 20736) { $image.GetPropertyItem(20736).Value } else { $null }
      $sources += [ordered]@{ file = $file; sha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash }
      for ($index = 0; $index -lt $count; $index++) {
        $null = $image.SelectActiveFrame($dimension, $index)
        $pixels = [UnitReferencePixels]::Read($image)
        $frameGrid = [UnitReferencePixels]::Grid($pixels, $width, $height)
        $grid = if ($grid -eq 0) { $frameGrid } else { [UnitReferencePixels]::Gcd($grid, $frameGrid) }
        $delay = if ($delays) { [BitConverter]::ToInt32($delays, $index * 4) * 10 } else {
          if (!$item.durationMs) { throw "Static image '$file' requires durationMs in its manifest" }
          $item.durationMs
        }
        if ($delay -le 0) { throw "Reference '$name' has no positive frame delay" }
        $rawFrames += [ordered]@{ durationMs = $delay; file = $file; index = $index }
        $pixels = $null
      }
    } finally { $image.Dispose() }
  }
  $requestedGrid = if ($null -ne $config.pixelScale) { $config.pixelScale } else { $grid }
  if ($requestedGrid -le 0 -or $requestedGrid -ne [Math]::Floor($requestedGrid) -or
      $width % $requestedGrid -ne 0 -or $height % $requestedGrid -ne 0) { throw "Invalid pixel scale for '$name'" }
  $grid = [int]$requestedGrid
  $nativeWidth = $width / $grid; $nativeHeight = $height / $grid
  if ($null -ne $config.cellScale -and (!($config.cellScale -is [ValueType]) -or $config.cellScale -is [bool] -or
      $config.cellScale -ne [Math]::Floor($config.cellScale) -or $config.cellScale -lt 1 -or
      $nativeWidth * $config.cellScale -gt 256 -or $nativeHeight * $config.cellScale -gt 256)) {
    throw "Invalid cellScale for '$name'; use a positive integer within the 256-cell canvas limit"
  }
  if ($nativeWidth -gt 128 -or $nativeHeight -gt 128) { throw "Native canvas for '$name' exceeds the supported 128-by-128 limit" }
  if ($result.clips.Count -gt 0) {
    $firstClip = $result.clips.Values | Select-Object -First 1
    if ($nativeWidth -ne $firstClip.width -or $nativeHeight -ne $firstClip.height) {
      throw "Native canvas for '$name' differs from the other clips; use consistent padding and pixelScale"
    }
  }
  if ($null -ne $config.footRow -and ($config.footRow -ne [Math]::Floor($config.footRow) -or
      $config.footRow -lt 1 -or $config.footRow -gt $nativeHeight)) { throw "Invalid footRow for '$name'" }
  $frames = @($rawFrames | ForEach-Object {
    $frame = $_
    $image = [System.Drawing.Image]::FromFile((Join-Path $Source $frame.file))
    try {
      $dimension = New-Object System.Drawing.Imaging.FrameDimension($image.FrameDimensionsList[0])
      $null = $image.SelectActiveFrame($dimension, $frame.index)
      $pixels = [UnitReferencePixels]::Read($image)
      [ordered]@{ durationMs = $frame.durationMs; runs = [UnitReferencePixels]::Runs($pixels, $width, $height, $grid) }
    } finally { $image.Dispose(); $pixels = $null }
  })
  $result.clips[$name] = [ordered]@{
    file = $sources[0].file; sources = $sources; sourceWidth = $width; sourceHeight = $height
    sourceSha256 = $sources[0].sha256; pixelScale = $grid; width = $width / $grid; height = $height / $grid; frames = $frames
  }
  Write-Output "$name`: $($width / $grid)-by-$($height / $grid), $($frames.Count) frames, source pixel scale $grid; all source pixels verified lossless"
}
if ($null -ne $config.cellScale) { $result.cellScale = $config.cellScale }
$json = $result | ConvertTo-Json -Depth 12 -Compress
[System.IO.File]::WriteAllText([System.IO.Path]::GetFullPath($Output), "const $Symbol = $json;`n", [System.Text.UTF8Encoding]::new($false))
