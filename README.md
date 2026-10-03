<!--
SPDX-FileCopyrightText: GSConnect Developers https://github.com/GSConnect

SPDX-License-Identifier: GPL-2.0-or-later
-->

# GSConnect (CONSTRUCT fork)

GSConnect is an implementation of [KDE Connect][kdeconnect] for GNOME Shell:
pair a phone or another desktop to share files, links and text, sync the
clipboard, contacts and notifications, send and receive messages, control
media players and the system volume, and run predefined commands. The KDE
Connect team has applications for Android, iOS, Linux, macOS and Windows.

This is the fork CONSTRUCT builds. It follows upstream's `main` on the
`gnome-51` branch and targets GNOME Shell 51 on Wayland only.

## Changes from upstream

- **Nothing of GSConnect stays alive on the lock screen.** The
  `keep-alive-when-locked` option replaced mutter's remote access inhibitor
  with a no-op, which left remote input working while locked and made the
  shell's uninhibit on unlock underflow mutter's counter. It is gone: the
  service stops when the session locks and starts again on unlock, without
  rewriting settings each time.
- **The clipboard portal answers only the GSConnect service.** The shell's
  `org.gnome.Shell.Extensions.GSConnect.Clipboard` refuses every other
  session bus client, and the service follows the clipboard only while a
  device has clipboard sending on.
- **Less work in the shell and the service**: no Gtk loaded into
  gnome-shell, menus rebuilt only when their model changes, reconnect
  attempts only while a known device is away (5 s backing off to 60 s), and
  no openssl run to read the certificate's common name.
- **Fixes for 51**: the device menu's icon buttons are no longer at the mercy
  of the tooltip's click gesture, and notifications go through the shell's
  own message tray code.
- **GNOME Shell 51 only**: `metadata.json` lists 51, and the code for older
  shells, GLib before 2.80, GIRepository 2.0 and desktops other than GNOME
  (wl-clipboard, ydotool, AT-SPI, the `gsconnect` CLI) is gone.
- **System install only**: no user-install setup, browser add-ons, native
  messaging host, Nautilus/Nemo extension, AppStream metainfo or firewalld
  service file.
- **Repository trimmed** to what the package is built from: no GitHub
  workflows, Crowdin config, zip packaging, ESLint or Python lint tooling.

## Building

GSConnect builds with meson:

```sh
meson setup _build --prefix=/usr \
    -Dgnome_shell_libdir=/usr/lib \
    -Dinstalled_tests=false
meson install -C _build
```

It installs the extension into
`/usr/share/gnome-shell/extensions/gsconnect@andyholmes.github.io`, its
schema, the `org.gnome.Shell.Extensions.GSConnect` D-Bus service and desktop
entries, the application icons and the translations. `gnome_shell_libdir` is
the directory holding `gnome-shell/Gvc-1.0.typelib`, which the system volume
plugin loads.

The service and the preferences window are GTK 3 programs run with gjs, so
the image needs the Gtk-3.0, Gdk-3.0, GdkPixbuf and Pango typelibs,
`openssl` to create the device certificate, and `ssh-keygen` and `ssh-add`
for SFTP browsing. KDE Connect talks over TCP and UDP ports 1714 to 1764.

`meson test -C _build` runs the Jasmine suites in `installed-tests/`.

## Attribution and license

GSConnect is by Andy Holmes and the other GSConnect developers and
translators: <https://github.com/GSConnect/gnome-shell-extension-gsconnect>.

GPL-2.0-or-later, except `installed-tests/jasmine.js` (MPL-2.0); see
`LICENSES/`.

[kdeconnect]: https://userbase.kde.org/KDEConnect
