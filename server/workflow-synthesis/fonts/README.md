# Final-record PDF fonts

The final-record PDF renderer embeds the following application-owned font
files so te reo Māori macrons render portably in every server environment:

- `NotoSans-Regular.ttf` — SHA-256
  `478c558ea716033cd60c03438f628dfa75694dcf6b5f6d505a2f05fd2b4f3823`
- `NotoSans-Bold.ttf` — SHA-256
  `1df075a380fc7cb898acf64c1f7b3b4dd780de3caa860178bf929de35817a913`

Source: the official Noto Latin, Greek and Cyrillic project,
[`NotoSans-v2.015`](https://github.com/notofonts/latin-greek-cyrillic/releases/tag/NotoSans-v2.015),
`NotoSans/hinted/ttf`.

License: SIL Open Font License, Version 1.1. The complete license text is
included as [`OFL.txt`](./OFL.txt).

These files are deliberately bundled with the server source. The renderer must
not depend on a developer-machine or host-system font installation.
