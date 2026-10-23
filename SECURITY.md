# Security

Chat Archive stores sensitive data in the browser and does not encrypt it. Someone with access to an unlocked device, browser profile or backup may be able to read the archive. A compromised operating system is also outside the app's protection. Browser eviction and device loss can remove the data, so keep protected external backups and the original exports.

The app renders imported text through DOM text nodes. It offers HTML and SVG attachments as downloads rather than displaying them as active content. Media object URLs are temporary. ZIP processing rejects unsafe paths and limits extracted data, but those checks cannot guarantee that every hostile file is harmless. Browser codecs and resource limits still matter. Backup hashes detect corruption; they do not establish who created the file.

The app has no conversation upload, analytics, remote previews or account integration. External links open only when you choose them. Hosting providers receive normal requests for public app files. Use HTTPS, keep the same origin for updates, review dependencies before deploying and run development servers on a trusted computer.

## Report a problem

Use the repository host's private vulnerability reporting if it is enabled. Otherwise, contact the maintainer privately through a contact listed on their profile. If you cannot find a private channel, open an issue asking for one without describing sensitive details.

Send a small synthetic reproduction, the application revision, browser version and affected code path. Never post private conversations, backups or device identifiers in a public issue.
