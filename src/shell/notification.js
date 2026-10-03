// SPDX-FileCopyrightText: GSConnect Developers https://github.com/GSConnect
//
// SPDX-License-Identifier: GPL-2.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import * as NotificationDaemon from 'resource:///org/gnome/shell/ui/notificationDaemon.js';


const APP_ID = 'org.gnome.Shell.Extensions.GSConnect';
const APP_PATH = '/org/gnome/Shell/Extensions/GSConnect';


// deviceId Pattern (<device-id>|<remote-id>)
const DEVICE_REGEX = new RegExp(/^([^|]+)\|([\s\S]+)$/);

// requestReplyId Pattern (<device-id>|<remote-id>)|<reply-id>)
const REPLY_REGEX = new RegExp(/^([^|]+)\|([\s\S]+)\|([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/, 'i');


/**
 * Extracted from notificationDaemon.js, as it's no longer exported
 * https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/main/js/ui/notificationDaemon.js#L556
 *
 * @returns {{ 'desktop-startup-id': string }}
 *          Object with ID containing current time
 */
function getPlatformData() {
    const startupId = GLib.Variant.new('s', `_TIME${global.get_current_time()}`);
    return {'desktop-startup-id': startupId};
}

// This is no longer directly exported, so we do this instead for now
const GtkNotificationDaemon = Main.notificationDaemon._gtkNotificationDaemon.constructor;


/**
 * A custom notification source for spawning notifications and closing device
 * notifications. This source isn't actually used, but it's methods are patched
 * into existing sources.
 */
const Source = GObject.registerClass({
    GTypeName: 'GSConnectNotificationSource',
}, class Source extends NotificationDaemon.GtkNotificationDaemonAppSource {

    _closeGSConnectNotification(notification, reason) {
        if (reason !== MessageTray.NotificationDestroyedReason.DISMISSED)
            return;

        // Avoid sending the request multiple times
        if (notification._remoteClosed || notification.remoteId === undefined)
            return;

        notification._remoteClosed = true;

        const target = new GLib.Variant('(ssbv)', [
            notification.deviceId,
            'closeNotification',
            true,
            new GLib.Variant('s', notification.remoteId),
        ]);
        const platformData = getPlatformData();

        Gio.DBus.session.call(
            APP_ID,
            APP_PATH,
            'org.freedesktop.Application',
            'ActivateAction',
            GLib.Variant.new('(sava{sv})', ['device', [target], platformData]),
            null,
            Gio.DBusCallFlags.NO_AUTO_START,
            -1,
            null,
            (connection, res) => {
                try {
                    connection.call_finish(res);
                } catch {
                    // If we fail, reset in case we can try again
                    notification._remoteClosed = false;
                }
            }
        );
    }

    /*
     * Parse the id to determine if it's a repliable notification, device
     * notification or a regular local notification
     */
    _parseNotificationId(notificationId) {
        let idMatch, deviceId, requestReplyId, remoteId, localId;

        if ((idMatch = REPLY_REGEX.exec(notificationId))) {
            [, deviceId, remoteId, requestReplyId] = idMatch;
            localId = `${deviceId}|${remoteId}`;

        } else if ((idMatch = DEVICE_REGEX.exec(notificationId))) {
            [, deviceId, remoteId] = idMatch;
            localId = `${deviceId}|${remoteId}`;

        } else {
            localId = notificationId;
        }
        return [idMatch, deviceId, requestReplyId, remoteId, localId];
    }

    /*
     * Add notification to source or update existing notification with extra
     * GsConnect information
     */
    _createNotification(notification) {
        const [
            idMatch,
            deviceId,
            requestReplyId,
            remoteId,
            localId,
        ] = this._parseNotificationId(notification.id);
        const cachedNotification = this._notifications[localId];

        // Check if this is a repeat
        if (cachedNotification) {
            cachedNotification.requestReplyId = requestReplyId;

            const title = notification.title;
            const body = notification.body
                ? notification.body
                : null;

            // Bail early If @notification represents an exact repeat
            if (cachedNotification.title === title &&
                cachedNotification.body === body)
                return cachedNotification;

            // If the details have changed, flag as an update
            cachedNotification.title = title;
            cachedNotification.body = body;
            cachedNotification.acknowledged = false;
            return cachedNotification;
        }

        // Device Notification
        if (idMatch) {
            notification.deviceId = deviceId;
            notification.remoteId = remoteId;
            notification.requestReplyId = requestReplyId;

            notification.connect('destroy', (notification, reason) => {
                this._closeGSConnectNotification(notification, reason);
                delete this._notifications[localId];
            });

        // Service Notification
        } else {
            notification.connect('destroy', (notification, reason) => {
                delete this._notifications[localId];
            });
        }

        this._notifications[localId] = notification;
        return notification;
    }

    /*
     * Override to control notification spawning
     */
    addNotification(notification) {
        this._notificationPending = true;

        const createdNotification = this._createNotification(notification);
        // Skip GtkNotificationDaemonAppSource.addNotification, which would
        // replace the cached notification by id instead of updating it.
        MessageTray.Source.prototype.addNotification.call(this, createdNotification);

        this._notificationPending = false;
    }
});


/**
 * If there is an active GtkNotificationDaemonAppSource for GSConnect when the
 * extension is loaded, it has to be patched in place.
 */
export function patchGSConnectNotificationSource() {
    const source = Main.notificationDaemon._gtkNotificationDaemon._sources[APP_ID];

    if (source !== undefined) {
        // Patch in the subclassed methods
        source._closeGSConnectNotification = Source.prototype._closeGSConnectNotification;
        source._parseNotificationId = Source.prototype._parseNotificationId;
        source._createNotification = Source.prototype._createNotification;
        source.addNotification = Source.prototype.addNotification;

        // Connect to existing notifications
        for (const notification of Object.values(source._notifications)) {

            const _id = notification.connect('destroy', (notification, reason) => {
                source._closeGSConnectNotification(notification, reason);
                notification.disconnect(_id);
            });
        }
    }
}


/**
 * Wrap GtkNotificationDaemon._ensureAppSource() to patch GSConnect's app source
 * https://gitlab.gnome.org/GNOME/gnome-shell/blob/master/js/ui/notificationDaemon.js#L742-755
 */
const __ensureAppSource = GtkNotificationDaemon.prototype._ensureAppSource;

// eslint-disable-next-line func-style
const _ensureAppSource = function (appId) {
    const source = __ensureAppSource.call(this, appId);

    if (source._appId === APP_ID) {
        source._closeGSConnectNotification = Source.prototype._closeGSConnectNotification;
        source._parseNotificationId = Source.prototype._parseNotificationId;
        source._createNotification = Source.prototype._createNotification;
        source.addNotification = Source.prototype.addNotification;
    }

    return source;
};


/**
 * Update the prototype for {@link GtkNotificationDaemon}.
 */
export function patchGtkNotificationDaemon() {
    GtkNotificationDaemon.prototype._ensureAppSource = _ensureAppSource;
}
