Get-ChildItem -Recurse -Include *.cs, *.csproj, project.godot, *.gdshader -Exclude bin, obj, .godot, .git | ForEach-Object {
    "=== START OF FILE: $($_.FullName) ==="
    Get-Content $_.FullName
    "=== END OF FILE ==="
    ""
} | Out-File -Encoding utf8 codebase.txt