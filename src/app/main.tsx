import { render } from "solid-js/web";
import { loadBundledFont } from "../text/loadFont";
import { Editor } from "./Editor";
import "./app.css";

// Text layers need the font to rebuild their outlines; wait for it so the first frame is right.
void loadBundledFont().finally(() => render(() => <Editor />, document.getElementById("root")!));
