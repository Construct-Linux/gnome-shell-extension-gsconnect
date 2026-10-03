// SPDX-FileCopyrightText: GSConnect Developers https://github.com/GSConnect
//
// SPDX-License-Identifier: GPL-2.0-or-later

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';


const DBUS_NAME = 'org.gnome.Shell.Extensions.GSConnect.Clipboard';
const DBUS_PATH = '/org/gnome/Shell/Extensions/GSConnect/Clipboard';


/**
 * The service class for this component.
 *
 * Writing `text` always reaches the session clipboard. Reading follows the
 * session clipboard only while someone holds a watch(), since every copy in
 * the session would otherwise cost two D-Bus round trips through the shell.
 */
const Clipboard = GObject.registerClass({
    GTypeName: 'GSConnectClipboard',
    Properties: {
        'text': GObject.ParamSpec.string(
            'text',
            'Text Content',
            'The current text content of the clipboard',
            GObject.ParamFlags.READWRITE,
            ''
        ),
    },
}, class Clipboard extends GObject.Object {

    _init() {
        super._init();

        this._cancellable = new Gio.Cancellable();
        this._available = false;
        this._watchers = 0;
        this._ownerChangeId = 0;

        this._nameWatcherId = Gio.bus_watch_name(
            Gio.BusType.SESSION,
            DBUS_NAME,
            Gio.BusNameWatcherFlags.NONE,
            this._onNameAppeared.bind(this),
            this._onNameVanished.bind(this)
        );
    }

    get text() {
        if (this._text === undefined)
            this._text = '';

        return this._text;
    }

    set text(content) {
        if (typeof content !== 'string')
            return;

        if (this.text !== content) {
            this._text = content;
            this.notify('text');
        }

        // The cached text is stale while nobody watches, so always write
        this._call('SetText', new GLib.Variant('(s)', [content]))
            .catch(e => debug(e));
    }

    /**
     * Start following the session clipboard. Every call must be paired with
     * a call to unwatch().
     */
    watch() {
        this._watchers++;

        if (this._watchers === 1)
            this._subscribe();
    }

    /**
     * Stop following the session clipboard.
     */
    unwatch() {
        this._watchers--;

        if (this._watchers === 0)
            this._unsubscribe();
    }

    /**
     * Read the session clipboard once and update `text`.
     */
    async refresh() {
        try {
            if (this._available)
                await this._updateText();
        } catch (e) {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                debug(e);
        }
    }

    _call(method, parameters = null) {
        if (!this._available)
            return Promise.reject(new Error('Clipboard portal not available'));

        return Gio.DBus.session.call(DBUS_NAME, DBUS_PATH, DBUS_NAME, method,
            parameters, null, Gio.DBusCallFlags.NO_AUTO_START, -1,
            this._cancellable);
    }

    _subscribe() {
        if (!this._available || this._ownerChangeId > 0)
            return;

        this._ownerChangeId = Gio.DBus.session.signal_subscribe(
            DBUS_NAME,
            DBUS_NAME,
            'OwnerChange',
            DBUS_PATH,
            null,
            Gio.DBusSignalFlags.NONE,
            () => this.refresh()
        );

        this.refresh();
    }

    _unsubscribe() {
        if (this._ownerChangeId > 0) {
            Gio.DBus.session.signal_unsubscribe(this._ownerChangeId);
            this._ownerChangeId = 0;
        }
    }

    _onNameAppeared(connection, name, name_owner) {
        this._available = true;

        if (this._watchers > 0)
            this._subscribe();
    }

    _onNameVanished(connection, name) {
        this._unsubscribe();
        this._available = false;
    }

    _applyUpdate(text) {
        if (typeof text !== 'string' || this.text === text)
            return;

        this._text = text;
        this.notify('text');
    }

    async _updateText() {
        let reply = await this._call('GetMimetypes');
        const mimetypes = reply.deepUnpack()[0];

        // Special case for a cleared clipboard
        if (mimetypes.length === 0)
            return this._applyUpdate('');

        // Special case to ignore copied files
        if (mimetypes.includes('text/uri-list'))
            return;

        reply = await this._call('GetText');
        const text = reply.deepUnpack()[0];

        this._applyUpdate(text);
    }

    destroy() {
        if (this._cancellable.is_cancelled())
            return;

        this._cancellable.cancel();
        this._unsubscribe();

        if (this._nameWatcherId > 0) {
            Gio.bus_unwatch_name(this._nameWatcherId);
            this._nameWatcherId = 0;
        }
    }
});

export default Clipboard;
