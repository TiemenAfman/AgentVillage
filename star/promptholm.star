"""
Applet: Promptholm
Summary: The island's name board
Description: What the desk display shows until somebody points it at something else.
Author: Promptholm
"""

load("render.star", "render")

def main(config):
    name = config.str("name", "Promptholm")
    line = config.str("line", "the island")

    return render.Root(
        delay = 90,
        child = render.Column(
            expanded = True,
            main_align = "space_evenly",
            cross_align = "center",
            children = [
                render.Marquee(
                    width = 64,
                    child = render.Text(name, font = "6x13", color = "#e8b45c"),
                ),
                render.Text(line, font = "tom-thumb", color = "#6fb84a"),
            ],
        ),
    )
