#!/usr/bin/env python3
"""Builds CruiseTycoon.rbxlx from src/ without needing Rojo installed.

Mirrors the Rojo mapping in default.project.json:
  src/ReplicatedStorage/Shared            -> ReplicatedStorage.Shared
  src/ServerScriptService                 -> ServerScriptService.Server
  src/StarterPlayer/StarterPlayerScripts  -> StarterPlayer.StarterPlayerScripts.Client

File conventions (same as Rojo):
  *.server.luau -> Script, *.client.luau -> LocalScript, *.luau -> ModuleScript,
  directories -> Folders.

Usage: python3 tools/build_rbxlx.py   (writes CruiseTycoon.rbxlx in the repo folder)
"""

from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
OUT = ROOT / "CruiseTycoon.rbxlx"

_referent = 0


def next_ref() -> str:
    global _referent
    _referent += 1
    return f"RBX{_referent}"


def item(class_name: str, name: str, extra_props: str = "", children: str = "") -> str:
    return (
        f'<Item class="{class_name}" referent="{next_ref()}">'
        f"<Properties><string name=\"Name\">{escape(name)}</string>{extra_props}</Properties>"
        f"{children}</Item>"
    )


def script_item(path: Path) -> str:
    stem = path.name
    if stem.endswith(".server.luau"):
        class_name, name = "Script", stem[: -len(".server.luau")]
    elif stem.endswith(".client.luau"):
        class_name, name = "LocalScript", stem[: -len(".client.luau")]
    elif stem.endswith(".luau"):
        class_name, name = "ModuleScript", stem[: -len(".luau")]
    else:
        return ""
    source = path.read_text(encoding="utf-8")
    return item(class_name, name, f'<ProtectedString name="Source">{escape(source)}</ProtectedString>')


def dir_children(directory: Path) -> str:
    parts = []
    for entry in sorted(directory.iterdir(), key=lambda p: (p.is_file(), p.name)):
        if entry.is_dir():
            parts.append(item("Folder", entry.name, children=dir_children(entry)))
        elif entry.suffix == ".luau" or entry.name.endswith(".luau"):
            parts.append(script_item(entry))
    return "".join(parts)


def service(class_name: str, children: str, extra_props: str = "") -> str:
    # Services use their class name as Name; Studio merges them into the DataModel.
    return (
        f'<Item class="{class_name}" referent="{next_ref()}">'
        f"<Properties><string name=\"Name\">{class_name}</string>{extra_props}</Properties>"
        f"{children}</Item>"
    )


def main() -> None:
    shared = item("Folder", "Shared", children=dir_children(SRC / "ReplicatedStorage" / "Shared"))
    server = item("Folder", "Server", children=dir_children(SRC / "ServerScriptService"))
    client = item("Folder", "Client", children=dir_children(SRC / "StarterPlayer" / "StarterPlayerScripts"))

    doc = (
        '<roblox xmlns:xmime="http://schemas.microsoft.com/appv/2006/xsd" '
        'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
        'xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd" version="4">'
        + service("Workspace", "", '<bool name="StreamingEnabled">true</bool>')
        + service("ReplicatedStorage", shared)
        + service("ServerScriptService", server)
        + service(
            "StarterPlayer",
            f'<Item class="StarterPlayerScripts" referent="{next_ref()}">'
            f'<Properties><string name="Name">StarterPlayerScripts</string></Properties>'
            f"{client}</Item>",
        )
        + "</roblox>"
    )
    OUT.write_text(doc, encoding="utf-8")
    print(f"Wrote {OUT} ({OUT.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
