# CHA immersive motion source

61 editable original compositions,1080×830,30fps,silent.

Extract the ZIP, then run from its root:

```sh
python3 scripts/motion-kit/immersive.py list
python3 scripts/motion-kit/immersive.py render create-prompt-image-grid
python3 scripts/motion-kit/immersive.py render record-linked-loupe --media /path/to/your-recording.mp4
```

Requirements: Python3, Node.js/npm, FFmpeg and FFprobe. The renderer uses HyperFrames0.8.105 through npx. `render` checks and encodes the selected composition locally. The default recording is original illustrative footage. Input duration requirements and editable variables are in each piece's meta.json. Camera coordinates are authored; they are not automatic cursor tracking.

Edit HTML and prompt.md under scripts/motion-kit/pieces. Output goes to content/projects/immersive-motion-kit. The clip command described in the original project guide requires the full Creator Studio Shorts toolkit and is not part of this standalone archive; use the1080×830 MP4 directly in a video editor.

Original CHA material remains © Career Hacker Alex. The resource page permits personal learning and content creation with its videos and prompts. Third-party font and runtime terms remain separate; see THIRD-PARTY-NOTICES.md and licenses/. No third-party code or font is relicensed by this archive.
