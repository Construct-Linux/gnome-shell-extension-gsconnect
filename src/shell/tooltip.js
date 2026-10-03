// SPDX-FileCopyrightText: GSConnect Developers https://github.com/GSConnect
//
// SPDX-License-Identifier: GPL-2.0-or-later

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

/**
 * An StTooltip for ClutterActors
 *
 * Adapted from: https://github.com/RaphaelRochet/applications-overview-tooltip
 * See also: https://github.com/GNOME/gtk/blob/master/gtk/gtktooltip.c
 */
export let TOOLTIP_BROWSE_ID = 0;
export let TOOLTIP_BROWSE_MODE = false;

export default class Tooltip {

    constructor(params) {
        Object.assign(this, params);

        this._bin = null;
        this._hoverTimeoutId = 0;
        this._showing = false;

        this._destroyId = this.parent.connect(
            'destroy',
            this.destroy.bind(this)
        );

        this._hoverId = this.parent.connect(
            'notify::hover',
            this._onHover.bind(this)
        );

        // A second click gesture on an St.Button would compete with the
        // button's own and can cancel it before 'clicked' is emitted, so
        // follow the button's pressed state instead.
        this._pressedId = 0;
        if (this.parent instanceof St.Button) {
            this._pressedId = this.parent.connect('notify::pressed', () => {
                if (this.parent.pressed)
                    this._hide();
            });
        }
    }

    get markup() {
        if (this._markup === undefined)
            this._markup = null;

        return this._markup;
    }

    set markup(text) {
        this._markup = text;
        this._text = null;

        if (this._showing)
            this._show();
    }

    get text() {
        if (this._text === undefined)
            this._text = null;

        return this._text;
    }

    set text(text) {
        this._markup = null;
        this._text = text;

        if (this._showing)
            this._show();
    }

    _show() {
        if (this.text === null && this.markup === null)
            return this._hide();

        if (this._bin === null) {
            this._bin = new St.Bin({
                style_class: 'osd-window gsconnect-tooltip',
                opacity: 232,
            });

            this.label = new St.Label({text: this.markup || this.text});
            this.label.clutter_text.line_wrap = true;
            this.label.clutter_text.line_wrap_mode = Pango.WrapMode.WORD;
            this.label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            this.label.clutter_text.use_markup = (this.markup);
            this._bin.child = this.label;

            Main.layoutManager.addTopChrome(this._bin);
        } else {
            this.label.clutter_text.text = this.markup || this.text;
            this.label.clutter_text.use_markup = (this.markup);
        }

        // Position tooltip
        let [x, y] = this.parent.get_transformed_position();
        x = (x + (this.parent.width / 2)) - Math.round(this._bin.width / 2);

        // Show tooltip
        if (this._showing) {
            this._bin.ease({
                x: x,
                y: y,
                time: 0.15,
                transition: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        } else {
            this._bin.set_position(x, y);
            this._bin.ease({
                opacity: 232,
                time: 0.15,
                transition: Clutter.AnimationMode.EASE_OUT_QUAD,
            });

            this._showing = true;
        }

        // Enable browse mode
        TOOLTIP_BROWSE_MODE = true;

        if (TOOLTIP_BROWSE_ID) {
            GLib.source_remove(TOOLTIP_BROWSE_ID);
            TOOLTIP_BROWSE_ID = 0;
        }

        if (this._hoverTimeoutId) {
            GLib.source_remove(this._hoverTimeoutId);
            this._hoverTimeoutId = 0;
        }
    }

    _hide() {
        if (this._bin) {
            this._bin.ease({
                opacity: 0,
                time: 0.10,
                transition: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    Main.layoutManager.removeChrome(this._bin);
                    this._bin.destroy();
                    this._bin = null;
                },
            });
        }

        TOOLTIP_BROWSE_ID = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            TOOLTIP_BROWSE_MODE = false;
            TOOLTIP_BROWSE_ID = 0;
            return false;
        });

        if (this._hoverTimeoutId) {
            GLib.source_remove(this._hoverTimeoutId);
            this._hoverTimeoutId = 0;
        }

        this._showing = false;
        this._hoverTimeoutId = 0;
    }

    _onHover() {
        if (this.parent.hover) {
            if (!this._hoverTimeoutId) {
                if (this._showing) {
                    this._show();
                } else {
                    this._hoverTimeoutId = GLib.timeout_add(
                        GLib.PRIORITY_DEFAULT,
                        (TOOLTIP_BROWSE_MODE) ? 60 : 500,
                        () => {
                            this._show();
                            this._hoverTimeoutId = 0;
                            return false;
                        }
                    );
                }
            }
        } else {
            this._hide();
        }
    }

    destroy() {
        this.parent.disconnect(this._destroyId);
        this.parent.disconnect(this._hoverId);
        if (this._pressedId)
            this.parent.disconnect(this._pressedId);

        if (this._bin) {
            Main.layoutManager.removeChrome(this._bin);
            this._bin.destroy();
        }

        if (TOOLTIP_BROWSE_ID) {
            GLib.source_remove(TOOLTIP_BROWSE_ID);
            TOOLTIP_BROWSE_ID = 0;
        }

        if (this._hoverTimeoutId) {
            GLib.source_remove(this._hoverTimeoutId);
            this._hoverTimeoutId = 0;
        }
    }
}
