# Shareable command lists

Twitch > Command list opens an operator-only generator on its own full-width tab. It reads the current saved chat-command snapshot. Nothing is selected automatically. Search and Active/All/Selected/Built-in filters keep large catalogs manageable. Select shown acts on the current filter; Clear selection clears the entire selection.

Descriptions, usage examples, manual entries, destination options, and the generated text are independent of runnable automations. Bot reply examples are opt-in and use read-only previews of selected chat-message actions with sample names; review the editable examples before sharing. Other action parameters and recipe code are not exported. This avoids publishing internal recipe code or accidentally embedded private text. User changes remain in memory while this page is open, including switching away and returning to the tab. Copy the finished text to retain it across page reloads. New manual entries document commands handled elsewhere; they do not create runnable commands.

The list includes custom saved commands and community built-ins only when Core advertises community-command support. Other provider-specific commands can be added manually. Permissions and cooldown labels describe saved configuration; missing OAuth grants, offline policies, and provider availability still apply at runtime.

## Destinations

Discord offers a compact Markdown list or a layout with one copyable code block per command. Descriptions, reply examples and limits appear outside the code block. Standard output targets 2,000 characters, with an explicit 4,000-character Nitro option. Headings, Markdown escapes, neutralized mentions, separators and line endings count toward each part. Whole entries remain together where possible; oversized entries continue in another independently formatted part. Splitting never drops selected entries. No webhooks, posting, external accounts, or online services are involved.

Twitch uses supported bold/list Markdown and hard line breaks. Its adjustable panel split target is a presentation preference, not an assertion of an official panel text cap. The 300-character profile bio is distinct from About panel descriptions. Copy each generated part into a separate panel description. Both destinations allow raw Markdown editing and provide an approximate safe preview; preview never executes HTML or inserts external media. Copy is disabled for manually edited parts that exceed their chosen limit; regeneration resplits the selected source entries.

The existing opaque-origin sandbox, no-network CSP and capability restrictions remain in force. Clipboard access falls back to selecting text for a manual copy when browser policy denies it. The full-page workspace avoids modal clipping. Clipboard writes are brokered by the same-origin host only for this first-party page, with a visible active frame and a recent user gesture. No clipboard read access is provided.

## References checked 2026-11-14

- [Discord sending messages](https://support.discord.com/hc/en-us/articles/360034632292-Sending-Messages): standard and Nitro message limits.
- [Discord Markdown](https://support.discord.com/hc/en-us/articles/210298617-Markdown-Text-101-Chat-Formatting-Bold-Italic-Underline): bold, lists, links.
- [Twitch Markdown basics](https://help.twitch.tv/s/article/markdown-basics?language=en_US): panel formatting.
- [Twitch channel page setup](https://help.twitch.tv/s/article/channel-page-setup?language=en_US): About panels and separate profile bio.

## Verification

Pure model tests cover unselected commands, omission of internal reply data, source immutability, message limits, escapes, oversized entries, and panel line breaks. Sandboxed browser tests cover selection, description edits, destination changes, mobile width, and unchanged runnable automations. Existing nested-dialog tests guard viewport positioning and focus return.
