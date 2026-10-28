/****************************************************************/
/*      Traktor Kontrol X1 MK2 HID controller script            */
/*      Copyright (C) 2021, infiniteloop                        */
/*      Copyright (C) 2026, the Mixxx Team                      */
/*      Based on:                                               */
/*      Traktor Kontrol S2 MK2 HID controller script v1.00      */
/*      Copyright (C) 2015, the Mixxx Team                      */
/*                                                              */
/* USB: Native Instruments 17cc:1220, HID interface 4.          */
/* This is the Mk2. The Mk1 MIDI mapping does not apply.        */
/* Input report 0x01, LED report 0x80, display report 0x81.     */
/* Enable "Log raw HID reports" to print X1MK2_HID_REPORT lines.*/
/****************************************************************/


// ==== Friendly User Configuration ====
// The Cue button, when Shift is also held, can have two possible functions:
// 1. "REWIND": seeks to the very start of the track.
// 2. "REVERSEROLL": performs a temporary reverse or "censor" effect, where the track
//    is momentarily played in reverse until the button is released.
var ShiftCueButtonAction = "REWIND";

// The Effects Unit can have two possible functions:
// 1. "FX": standard Effects Unit behavior
//    (knobs control effect parameters, buttons turn effects ON or OFF).
// 2. "FILTER": Mixer Filter Unit behavior
//    lower 3 rows: knobs control EQ filters' cutoff frequency, buttons act
//    as EQ filters' kill switches;
//    the top row with Shift released: knobs control volume, buttons act as CUE mix
//    (headphones) switches;
//    the top row with Shift held: knobs control filter cutoff frequency, buttons act
//    as filter ON/OFF switches.
var EffectUnitMode = "FX";

var OutputBrightnessMax = 0x7f;
// Set the brightness of button LEDs which are off and on. This uses a scale from 0 to 0x7f (127).
// If you don't have the optional power adapter and are using the controller with USB bus power,
// 0x09 is probably too dim to notice.
var ButtonBrightnessOff = 0x03;
var ButtonBrightnessOn = OutputBrightnessMax;

// KNOWN ISSUES:
// * The effect button LEDs briefly flicker when pressing the effect focus button.

var TraktorX1MK2 = new function() {
    this.controller = new HIDController();

    // When true, packets will not be sent to the controller.
    // Used when updating multiple LEDs simultaneously.
    this.batchingLEDUpdate = false;

    this.effectUnitMixerControl = EffectUnitMode === "FILTER";

    // Previous values, used for calculating deltas for encoder knobs.
    this.previousBrowse = 0;

    this.previousDeckEncoder = {
        "[Channel1]": 0,
        "[Channel2]": 0
    };

    this.stripeTouchInertiaTimer = {
        "[Channel1]": 0,
        "[Channel2]": 0
    };

    this.stripeTouchTime = 0;
    this.stripeCenterPressTimer = 0;

    this.deckEncoderPressed = {
        "[Channel1]": false,
        "[Channel2]": false
    };

    this.syncPressed = {
        "[Channel1]": false,
        "[Channel2]": false
    };

    this.browsePressed = false;
    this.shiftPressed = false;
    this.stripeCenterPressed = false;
    this.rateModified = false;

    this.padModes = {
        "hotcue": 0,
        "introOutro": 1,
        "sampler": 2
    };
    this.currentPadMode = {
        "[Channel1]": this.padModes.hotcue,
        "[Channel2]": this.padModes.hotcue
    };
    this.padConnections = {
        "[Channel1]": [],
        "[Channel2]": []
    };

    this.lastTouchChannel = [-1, -1];
    this.lastTickValue = [0, 0];
    this.lastTickTime = [0.0, 0.0];
    this.syncEnabledTime = {
        "[Channel1]": 0,
        "[Channel2]": 0
    };
    this.rateResetTime = {
        "[Channel1]": 0,
        "[Channel2]": 0
    };

    this.longPressTimeoutMilliseconds = 275;
    this.stripePressTimeoutMilliseconds = 50;

    this.effectButtonLongPressTimer = {
        "[EffectRack1_EffectUnit1]": [0, 0, 0, 0],
        "[EffectRack1_EffectUnit2]": [0, 0, 0, 0]
    };
    this.effectButtonIsLongPressed = {
        "[EffectRack1_EffectUnit1]": [false, false, false, false],
        "[EffectRack1_EffectUnit2]": [false, false, false, false]
    };
    this.effectFocusLongPressTimer = {
        "[EffectRack1_EffectUnit1]": 0,
        "[EffectRack1_EffectUnit2]": 0
    };
    this.effectFocusChooseModeActive = {
        "[EffectRack1_EffectUnit1]": false,
        "[EffectRack1_EffectUnit2]": false
    };
    this.effectFocusButtonPressedWhenParametersHidden = {
        "[EffectRack1_EffectUnit1]": false,
        "[EffectRack1_EffectUnit2]": false
    };
    this.previouslyFocusedEffect = {
        "[EffectRack1_EffectUnit1]": null,
        "[EffectRack1_EffectUnit2]": null
    };
    this.effectFocusButtonLEDconnections = {
        "[EffectRack1_EffectUnit1]": null,
        "[EffectRack1_EffectUnit2]": null
    };
    this.effectButtonLEDconnections = {
        "[EffectRack1_EffectUnit1]": [],
        "[EffectRack1_EffectUnit2]": []
    };

};

TraktorX1MK2.registerInputPackets = function() {
    var MessageShort = new HIDPacket("shortmessage", 0x01, this.shortMessageCallback);

    // An exclamation point indicates a specially-handled function.  Everything else is a standard
    // Mixxx control object name.

    MessageShort.addControl("[Master]", "!shift", 0x14, "B", 0x04, false, this.shift);
    MessageShort.addControl("[Master]", "!browse_press", 0x17, "B", 0x02, false, this.browsePress);

    MessageShort.addControl("[Master]", "!stripe_touch_timestamp", 0x19, "H", 0xFFFF, false, this.stripeTouchTimestamp);
    MessageShort.addControl("[Master]", "!stripe_touch0", 0x1B, "H", 0x07FF, false, this.stripeTouch);
    MessageShort.addControl("[Master]", "!stripe_touch1", 0x1D, "H", 0x07FF, false, this.stripeTouch);

    MessageShort.addControl("[Channel1]", "!deck_encoder_press", 0x17, "B", 0x01, false, this.deckEncoderPress);
    MessageShort.addControl("[Channel1]", "!load_track", 0x14, "B", 0x08, false, this.loadTrackButton);
    MessageShort.addControl("[Channel1]", "!pad1", 0x16, "B", 0x80, false, this.padButton);
    MessageShort.addControl("[Channel1]", "!pad2", 0x16, "B", 0x40, false, this.padButton);
    MessageShort.addControl("[Channel1]", "!pad3", 0x16, "B", 0x20, false, this.padButton);
    MessageShort.addControl("[Channel1]", "!pad4", 0x16, "B", 0x10, false, this.padButton);
    MessageShort.addControl("[Channel1]", "!flux_button", 0x16, "B", 0x08, false, this.introOutroModeButton);
    MessageShort.addControl("[Channel1]", "!sync_enabled", 0x16, "B", 0x04, false, this.syncButton);
    MessageShort.addControl("[Channel1]", "!cue_default", 0x16, "B", 0x02, false, this.cueButton);
    MessageShort.addControl("[Channel1]", "!play", 0x16, "B", 0x01, false, this.playButton);

    MessageShort.addControl("[Channel2]", "!deck_encoder_press", 0x14, "B", 0x01, false, this.deckEncoderPress);
    MessageShort.addControl("[Channel2]", "!load_track", 0x14, "B", 0x02, false, this.loadTrackButton);
    MessageShort.addControl("[Channel2]", "!pad1", 0x15, "B", 0x80, false, this.padButton);
    MessageShort.addControl("[Channel2]", "!pad2", 0x15, "B", 0x40, false, this.padButton);
    MessageShort.addControl("[Channel2]", "!pad3", 0x15, "B", 0x20, false, this.padButton);
    MessageShort.addControl("[Channel2]", "!pad4", 0x15, "B", 0x10, false, this.padButton);
    MessageShort.addControl("[Channel2]", "!flux_button", 0x15, "B", 0x08, false, this.introOutroModeButton);
    MessageShort.addControl("[Channel2]", "!sync_enabled", 0x15, "B", 0x04, false, this.syncButton);
    MessageShort.addControl("[Channel2]", "!cue_default", 0x15, "B", 0x02, false, this.cueButton);
    MessageShort.addControl("[Channel2]", "!play", 0x15, "B", 0x01, false, this.playButton);

    MessageShort.addControl("[EffectRack1_EffectUnit1]", "!effect_focus_button", 0x13, "B", 0x80, false, this.effectFocusButton);
    MessageShort.addControl("[EffectRack1_EffectUnit1]", "!effectbutton1", 0x13, "B", 0x40, false, this.effectButton);
    MessageShort.addControl("[EffectRack1_EffectUnit1]", "!effectbutton2", 0x13, "B", 0x20, false, this.effectButton);
    MessageShort.addControl("[EffectRack1_EffectUnit1]", "!effectbutton3", 0x13, "B", 0x10, false, this.effectButton);

    MessageShort.addControl("[EffectRack1_EffectUnit2]", "!effect_focus_button", 0x13, "B", 0x08, false, this.effectFocusButton);
    MessageShort.addControl("[EffectRack1_EffectUnit2]", "!effectbutton1", 0x13, "B", 0x04, false, this.effectButton);
    MessageShort.addControl("[EffectRack1_EffectUnit2]", "!effectbutton2", 0x13, "B", 0x02, false, this.effectButton);
    MessageShort.addControl("[EffectRack1_EffectUnit2]", "!effectbutton3", 0x13, "B", 0x01, false, this.effectButton);

    MessageShort.addControl("[EffectRack1_EffectUnit1]", "group_[Channel1]_enable", 0x14, "B", 0x80);
    MessageShort.addControl("[EffectRack1_EffectUnit2]", "group_[Channel1]_enable", 0x14, "B", 0x40);
    MessageShort.addControl("[EffectRack1_EffectUnit1]", "group_[Channel2]_enable", 0x14, "B", 0x20);
    MessageShort.addControl("[EffectRack1_EffectUnit2]", "group_[Channel2]_enable", 0x14, "B", 0x10);

    MessageShort.addControl("[EffectRack1_EffectUnit1]", "!effectmixknob", 0x01, "H", 0x0FFF, false, this.effectMixKnob);
    MessageShort.addControl("[EffectRack1_EffectUnit1]", "!effectknob1", 0x03, "H", 0x0FFF, false, this.effectKnob);
    MessageShort.addControl("[EffectRack1_EffectUnit1]", "!effectknob2", 0x05, "H", 0x0FFF, false, this.effectKnob);
    MessageShort.addControl("[EffectRack1_EffectUnit1]", "!effectknob3", 0x07, "H", 0x0FFF, false, this.effectKnob);

    MessageShort.addControl("[EffectRack1_EffectUnit2]", "!effectmixknob", 0x09, "H", 0x0FFF, false, this.effectMixKnob);
    MessageShort.addControl("[EffectRack1_EffectUnit2]", "!effectknob1", 0x0B, "H", 0x0FFF, false, this.effectKnob);
    MessageShort.addControl("[EffectRack1_EffectUnit2]", "!effectknob2", 0x0D, "H", 0x0FFF, false, this.effectKnob);
    MessageShort.addControl("[EffectRack1_EffectUnit2]", "!effectknob3", 0x0F, "H", 0x0FFF, false, this.effectKnob);

    MessageShort.addControl("[Channel1]", "!deck_encoder", 0x11, "B", 0x0F, false, this.deckEncoder);
    MessageShort.addControl("[Channel2]", "!deck_encoder", 0x12, "B", 0x0F, false, this.deckEncoder);
    MessageShort.addControl("[Playlist]", "!browse", 0x11, "B", 0xF0, false, this.browseEncoder);

    engine.makeConnection("[EffectRack1_EffectUnit1]", "show_parameters", TraktorX1MK2.onShowParametersChange);
    engine.makeConnection("[EffectRack1_EffectUnit2]", "show_parameters", TraktorX1MK2.onShowParametersChange);

    for (var i = 1; i <= 3; i++) {
        engine.softTakeover("[EffectRack1_EffectUnit1_Effect" + i + "]", "meta", true);
        engine.softTakeover("[EffectRack1_EffectUnit2_Effect" + i + "]", "meta", true);
        for (var j = 1; j <= 3; j++) {
            engine.softTakeover("[EffectRack1_EffectUnit1_Effect" + i + "]", "parameter" + j, true);
            engine.softTakeover("[EffectRack1_EffectUnit2_Effect" + i + "]", "parameter" + j, true);
        }
    }

    // Set scalers
    TraktorX1MK2.scalerParameter.useSetParameter = true;
    this.controller.setScaler("mix", this.scalerParameter);
    this.controller.setScaler("parameter1", this.scalerParameter);
    this.controller.setScaler("parameter2", this.scalerParameter);
    this.controller.setScaler("parameter3", this.scalerParameter);

    // Register packet
    this.controller.registerInputPacket(MessageShort);
};

TraktorX1MK2.registerOutputPackets = function() {
    var OutputButtons = new HIDPacket("outputButtons", 0x80);
    var OutputDisplay = new HIDPacket("outputDisplay", 0x81);

    /*OutputButtons.addOutput("[Master]", "!usblight", 0x1D, "B");*/
    OutputButtons.addOutput("[Master]", "!shift", 0x12, "B");

    OutputButtons.addOutput("[EffectRack1_EffectUnit1]", "!effect_focus_button", 0x01, "B");
    OutputButtons.addOutput("[EffectRack1_EffectUnit1]", "!effectbutton1", 0x02, "B");
    OutputButtons.addOutput("[EffectRack1_EffectUnit1]", "!effectbutton2", 0x03, "B");
    OutputButtons.addOutput("[EffectRack1_EffectUnit1]", "!effectbutton3", 0x04, "B");

    OutputButtons.addOutput("[EffectRack1_EffectUnit2]", "!effect_focus_button", 0x05, "B");
    OutputButtons.addOutput("[EffectRack1_EffectUnit2]", "!effectbutton1", 0x06, "B");
    OutputButtons.addOutput("[EffectRack1_EffectUnit2]", "!effectbutton2", 0x07, "B");
    OutputButtons.addOutput("[EffectRack1_EffectUnit2]", "!effectbutton3", 0x08, "B");

    OutputButtons.addOutput("[EffectRack1_EffectUnit1]", "group_[Channel1]_enable", 0x09, "B");
    OutputButtons.addOutput("[EffectRack1_EffectUnit2]", "group_[Channel1]_enable", 0x0A, "B");
    OutputButtons.addOutput("[EffectRack1_EffectUnit1]", "group_[Channel2]_enable", 0x0F, "B");
    OutputButtons.addOutput("[EffectRack1_EffectUnit2]", "group_[Channel2]_enable", 0x10, "B");

    OutputButtons.addOutput("[EffectRack1_EffectUnit1]", "!arrow_left", 0x0B, "B");
    OutputButtons.addOutput("[EffectRack1_EffectUnit1]", "!arrow_right", 0x0C, "B");
    OutputButtons.addOutput("[EffectRack1_EffectUnit2]", "!arrow_left", 0x0D, "B");
    OutputButtons.addOutput("[EffectRack1_EffectUnit2]", "!arrow_right", 0x0E, "B");

    OutputButtons.addOutput("[Channel1]", "track_loaded", 0x11, "B");

    OutputButtons.addOutput("[Channel1]", "!pad_1_R", 0x14, "B");
    OutputButtons.addOutput("[Channel1]", "!pad_1_G", 0x15, "B");
    OutputButtons.addOutput("[Channel1]", "!pad_1_B", 0x16, "B");

    OutputButtons.addOutput("[Channel1]", "!pad_2_R", 0x17, "B");
    OutputButtons.addOutput("[Channel1]", "!pad_2_G", 0x18, "B");
    OutputButtons.addOutput("[Channel1]", "!pad_2_B", 0x19, "B");

    OutputButtons.addOutput("[Channel1]", "!pad_3_R", 0x20, "B");
    OutputButtons.addOutput("[Channel1]", "!pad_3_G", 0x21, "B");
    OutputButtons.addOutput("[Channel1]", "!pad_3_B", 0x22, "B");

    OutputButtons.addOutput("[Channel1]", "!pad_4_R", 0x23, "B");
    OutputButtons.addOutput("[Channel1]", "!pad_4_G", 0x24, "B");
    OutputButtons.addOutput("[Channel1]", "!pad_4_B", 0x25, "B");

    OutputButtons.addOutput("[Channel1]", "!flux_button", 0x2C, "B");
    OutputButtons.addOutput("[Channel1]", "sync_enabled", 0x2D, "B");
    OutputButtons.addOutput("[Channel1]", "cue_indicator", 0x30, "B");
    OutputButtons.addOutput("[Channel1]", "play_indicator", 0x31, "B");

    OutputButtons.addOutput("[Channel2]", "track_loaded", 0x13, "B");

    OutputButtons.addOutput("[Channel2]", "!pad_1_R", 0x1A, "B");
    OutputButtons.addOutput("[Channel2]", "!pad_1_G", 0x1B, "B");
    OutputButtons.addOutput("[Channel2]", "!pad_1_B", 0x1C, "B");

    OutputButtons.addOutput("[Channel2]", "!pad_2_R", 0x1D, "B");
    OutputButtons.addOutput("[Channel2]", "!pad_2_G", 0x1E, "B");
    OutputButtons.addOutput("[Channel2]", "!pad_2_B", 0x1F, "B");

    OutputButtons.addOutput("[Channel2]", "!pad_3_R", 0x26, "B");
    OutputButtons.addOutput("[Channel2]", "!pad_3_G", 0x27, "B");
    OutputButtons.addOutput("[Channel2]", "!pad_3_B", 0x28, "B");

    OutputButtons.addOutput("[Channel2]", "!pad_4_R", 0x29, "B");
    OutputButtons.addOutput("[Channel2]", "!pad_4_G", 0x2A, "B");
    OutputButtons.addOutput("[Channel2]", "!pad_4_B", 0x2B, "B");

    OutputButtons.addOutput("[Channel2]", "!flux_button", 0x2E, "B");
    OutputButtons.addOutput("[Channel2]", "sync_enabled", 0x2F, "B");
    OutputButtons.addOutput("[Channel2]", "cue_indicator", 0x32, "B");
    OutputButtons.addOutput("[Channel2]", "play_indicator", 0x33, "B");

    this.controller.registerOutputPacket(OutputButtons);

    for (let i = 0; i < 24; i++) {
        OutputDisplay.addOutput("[Channel1]", "!display_segment" + i,
                                0x01 + i, "B");
        OutputDisplay.addOutput("[Channel2]", "!display_segment" + i,
                                0x19 + i, "B");
    }

    for (let i = 0; i < 21; i++) {
        OutputDisplay.addOutput("[Master]", "!stripe_segment" + i + "_R",
                                0x31 + i * 2, "B");
        OutputDisplay.addOutput("[Master]", "!stripe_segment" + i + "_B",
                                0x32 + i * 2, "B");
    }

    this.controller.registerOutputPacket(OutputDisplay);

    // Link up control objects to their outputs
    TraktorX1MK2.linkDeckOutputs("sync_enabled", TraktorX1MK2.outputCallback);
    TraktorX1MK2.linkDeckOutputs("cue_indicator", TraktorX1MK2.outputCallback);
    TraktorX1MK2.linkDeckOutputs("play_indicator", TraktorX1MK2.outputCallback);

    TraktorX1MK2.setPadMode("[Channel1]", TraktorX1MK2.padModes.hotcue);
    TraktorX1MK2.setPadMode("[Channel2]", TraktorX1MK2.padModes.hotcue);

    TraktorX1MK2.linkDeckOutputs("keylock", TraktorX1MK2.outputCallbackDark);
    TraktorX1MK2.linkDeckOutputs("LoadSelectedTrack", TraktorX1MK2.outputCallback);
    TraktorX1MK2.linkDeckOutputs("slip_enabled", TraktorX1MK2.outputCallback);
    TraktorX1MK2.linkChannelOutput("[Channel1]", "track_loaded", TraktorX1MK2.outputChannelCallback);
    TraktorX1MK2.linkChannelOutput("[Channel2]", "track_loaded", TraktorX1MK2.outputChannelCallback);
    TraktorX1MK2.linkChannelOutput("[EffectRack1_EffectUnit1]", "group_[Channel1]_enable", TraktorX1MK2.outputChannelCallback);
    TraktorX1MK2.linkChannelOutput("[EffectRack1_EffectUnit2]", "group_[Channel1]_enable", TraktorX1MK2.outputChannelCallback);
    TraktorX1MK2.linkChannelOutput("[EffectRack1_EffectUnit1]", "group_[Channel2]_enable", TraktorX1MK2.outputChannelCallback);
    TraktorX1MK2.linkChannelOutput("[EffectRack1_EffectUnit2]", "group_[Channel2]_enable", TraktorX1MK2.outputChannelCallback);

    engine.makeConnection("[EffectRack1_EffectUnit1]", "focused_effect", TraktorX1MK2.onFocusedEffectChange).trigger();
    engine.makeConnection("[EffectRack1_EffectUnit2]", "focused_effect", TraktorX1MK2.onFocusedEffectChange).trigger();
    if (TraktorX1MK2.effectUnitMixerControl) {
        TraktorX1MK2.connectEffectFocusButtonLEDs("[EffectRack1_EffectUnit1]");
        TraktorX1MK2.connectEffectFocusButtonLEDs("[EffectRack1_EffectUnit2]");
    }
    TraktorX1MK2.connectEffectButtonLEDs("[EffectRack1_EffectUnit1]");
    TraktorX1MK2.connectEffectButtonLEDs("[EffectRack1_EffectUnit2]");

    engine.makeConnection("[Channel1]", "rate", TraktorX1MK2.onRateChanged);
    engine.makeConnection("[Channel2]", "rate", TraktorX1MK2.onRateChanged);
    engine.makeConnection("[Channel1]", "loop_enabled", TraktorX1MK2.onLoopEnabledChanged);
    engine.makeConnection("[Channel2]", "loop_enabled", TraktorX1MK2.onLoopEnabledChanged);
    engine.makeConnection("[Channel1]", "beatloop_size", TraktorX1MK2.onBeatloopSizeChanged);
    engine.makeConnection("[Channel2]", "beatloop_size", TraktorX1MK2.onBeatloopSizeChanged);
    engine.makeConnection("[Channel1]", "beatjump_size", TraktorX1MK2.onBeatjumpSizeChanged);
    engine.makeConnection("[Channel2]", "beatjump_size", TraktorX1MK2.onBeatjumpSizeChanged);
};

TraktorX1MK2.linkDeckOutputs = function(key, callback) {
    // Linking outputs is a little tricky because the library doesn't quite do what I want.  But this
    // method works.
    TraktorX1MK2.controller.linkOutput("[Channel1]", key, "[Channel1]", key, callback);
    engine.makeConnection("[Channel3]", key, callback);
    TraktorX1MK2.controller.linkOutput("[Channel2]", key, "[Channel2]", key, callback);
    engine.makeConnection("[Channel4]", key, callback);
};

TraktorX1MK2.linkChannelOutput = function(group, key, callback) {
    TraktorX1MK2.controller.linkOutput(group, key, group, key, callback);
};

TraktorX1MK2.lightGroup = function(packet, outputGroupName, coGroupName) {
    var groupObject = packet.groups[outputGroupName];
    for (var fieldName in groupObject) {
        var field = groupObject[fieldName];
        if ((field.name === "!arrow_left") && (outputGroupName === "[EffectRack1_EffectUnit2]") ||
            (field.name === "!arrow_right") && (outputGroupName === "[EffectRack1_EffectUnit1]")) {
            TraktorX1MK2.controller.setOutput(outputGroupName, field.name,
                                              OutputBrightnessMax,
                                              !TraktorX1MK2.batchingLEDUpdate);
        }
        if ((field.name === "!arrow_left") && (outputGroupName === "[EffectRack1_EffectUnit1]") ||
            (field.name === "!arrow_right") && (outputGroupName === "[EffectRack1_EffectUnit2]")) {
            TraktorX1MK2.controller.setOutput(outputGroupName, field.name,
                                              TraktorX1MK2.effectUnitMixerControl ?
                                              0x00 : OutputBrightnessMax,
                                              !TraktorX1MK2.batchingLEDUpdate);
        }
        if (field.name[0] === "!") {
            continue;
        }
        if (field.mapped_callback) {
            var value = engine.getValue(coGroupName, field.name);
            field.mapped_callback(value, coGroupName, field.name);
        }
    // No callback, no light!
    }
};

TraktorX1MK2.lightDeck = function(group) {
    // Freeze the lights while we do this update so we don't spam HID.
    this.batchingLEDUpdate = true;
    for (var packetName in this.controller.OutputPackets) {
        var packet = this.controller.OutputPackets[packetName];
        TraktorX1MK2.lightGroup(packet, group, group);
        // These outputs show state managed by this script and do not react to ControlObject changes,
        // so manually set them here.
        TraktorX1MK2.outputCallback(0, group, "!flux_button");
    }

    this.batchingLEDUpdate = false;
    // And now send them all.
    for (packetName in this.controller.OutputPackets) {
        this.controller.OutputPackets[packetName].send();
    }
};

TraktorX1MK2.lightStripe = function() {
    var blueSegments = [  1,  2,  3,  4,  5,  6,  7,  8,
                         12, 13, 14, 15, 16, 17, 18, 19 ];
    var redSegments = [  0,  9,
                        11, 20 ];
    for (let i in blueSegments) {
        this.controller.setOutput("[Master]",
                                  "!stripe_segment" + blueSegments[i] + "_B",
                                  OutputBrightnessMax, false);
    }
    for (let i in redSegments) {
        this.controller.setOutput("[Master]",
                                  "!stripe_segment" + redSegments[i] + "_R",
                                  OutputBrightnessMax, false);
    }
    this.controller.OutputPackets["outputDisplay"].send();
}

TraktorX1MK2.init = function() {
    TraktorX1MK2.logRawHidReports = engine.getSetting("logRawHidReports") === true;
    if (TraktorX1MK2.logRawHidReports) {
        console.log("X1MK2_HID_REPORT logging enabled. Input reports are printed as hex.");
    }
    if (!(ShiftCueButtonAction === "REWIND" || ShiftCueButtonAction === "REVERSEROLL")) {
        throw new Error("ShiftCueButtonAction must be either \"REWIND\" or \"REVERSEROLL\"\n" +
            "ShiftCueButtonAction is: " + ShiftCueButtonAction);
    }
    if (typeof ButtonBrightnessOff !== "number" ||
        ButtonBrightnessOff < 0 ||
        ButtonBrightnessOff > OutputBrightnessMax) {
        throw new Error("ButtonBrightnessOff must be a number between 0 and 0x7f (127).\n" +
            "ButtonBrightnessOff is: " + ButtonBrightnessOff);
    }
    if (typeof ButtonBrightnessOn !== "number" ||
        ButtonBrightnessOn < 0 ||
        ButtonBrightnessOn > OutputBrightnessMax) {
        throw new Error("ButtonBrightnessOn must be a number between 0 and 0x7f (127).\n" +
            "ButtonBrightnessOn is: " + ButtonBrightnessOn);
    }
    if (ButtonBrightnessOn < ButtonBrightnessOff) {
        throw new Error("ButtonBrightnessOn must be greater than ButtonBrightnessOff.\n" +
            "ButtonBrightnessOn is: " + ButtonBrightnessOn + "\n" +
            "ButtonBrightnessOff is: " + ButtonBrightnessOff);
    }

    TraktorX1MK2.registerInputPackets();

    var debugLEDs = false;
    if (debugLEDs) {
        var data0 = [ 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f,
                      0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f,
                      0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f,
                      0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f,
                      0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f,
                      0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f,
                      0x7f, 0x7f, 0x7f
                    ];
        var data1 = [ 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                      0x00, 0x00
                    ];
        controller.send(data0, data0.length, 0x82);
        controller.send(data1, data1.length, 0x81);
    } else {
        TraktorX1MK2.registerOutputPackets();
    }

    /*TraktorX1MK2.controller.setOutput("[Master]", "!usblight", OutputBrightnessMax, true);*/
    TraktorX1MK2.controller.setOutput("[Master]", "!shift", ButtonBrightnessOff, true);
    TraktorX1MK2.lightDeck("[Channel1]");
    TraktorX1MK2.lightDeck("[Channel2]");
    TraktorX1MK2.lightDeck("[EffectRack1_EffectUnit1]");
    TraktorX1MK2.lightDeck("[EffectRack1_EffectUnit2]");
    TraktorX1MK2.lightStripe();
    TraktorX1MK2.displayLoopSize("[Channel1]");
    TraktorX1MK2.displayLoopSize("[Channel2]");
};

TraktorX1MK2.shutdown = function() {
    var data = [];
    for (var i = 0; i < 51; i++) {
        data[i] = 0;
    }
    // Leave USB plug indicator light on.
    /*data[0x1C] = ButtonBrightnessOn;*/
    controller.send(data, data.length, 0x80);

    for (i = 0; i < 90; i++) {
        data[i] = 0;
    }
    controller.send(data, data.length, 0x81);
};

TraktorX1MK2.formatHidReport = function(data) {
    const bytes = [];
    const length = data.length;
    for (let index = 0; index < length; index++) {
        const value = data[index] & 0xff;
        const hex = value.toString(16);
        bytes.push(hex.length === 1 ? "0" + hex : hex);
    }
    return bytes.join(" ");
};

TraktorX1MK2.incomingData = function(data, length) {
    if (TraktorX1MK2.logRawHidReports) {
        console.log("X1MK2_HID_REPORT " + length + " " + TraktorX1MK2.formatHidReport(data));
    }
    TraktorX1MK2.controller.parsePacket(data, length);
};

TraktorX1MK2.shortMessageCallback = function(packet, data) {
    for (var name in data) {
        var field = data[name];
        if ((field.name === "!stripe_touch_timestamp") ||
            (field.name === "!stripe_touch0") ||
            (field.name === "!stripe_touch1") ||
            (field.name === "!effectmixknob") ||
            (field.name === "!effectknob1") ||
            (field.name === "!effectknob2") ||
            (field.name === "!effectknob3") ||
            (field.name === "!deck_encoder") ||
            (field.name === "!browse") ||
            (field.name === "mix")) {
            TraktorX1MK2.controller.processControl(field);
            continue;
        }

        TraktorX1MK2.controller.processButton(field);
    }
};

TraktorX1MK2.toggleButton = function(field) {
    if (field.value > 0) {
        script.toggleControl(field.group, field.name);
    }
};

TraktorX1MK2.shift = function(field) {
    var group = field.group;
    TraktorX1MK2.shiftPressed = field.value > 0;

    TraktorX1MK2.controller.setOutput(group, "!shift",
        TraktorX1MK2.shiftPressed ? ButtonBrightnessOn : ButtonBrightnessOff, group, "!shift",
        !TraktorX1MK2.batchingLEDUpdate);
    if (TraktorX1MK2.shiftPressed) {
        for (let i = 1; i <= 2; i++) {
            group = "[Channel" + i + "]";
            if (!TraktorX1MK2.syncPressed[group]) {
                TraktorX1MK2.displayBeatjumpSize(group);
            }
        }
    } else {
        for (let i = 1; i <= 2; i++) {
            group = "[Channel" + i + "]";
            if (!TraktorX1MK2.syncPressed[group]) {
                TraktorX1MK2.displayLoopSize(group);
            }
        }
    }
    if (TraktorX1MK2.effectUnitMixerControl) {
        for (let i = 1; i <= 2; i++) {
            TraktorX1MK2.connectEffectFocusButtonLEDs("[EffectRack1_EffectUnit" + i + "]");
        }
    }
};

TraktorX1MK2.loadTrackButton = function(field) {
    if (TraktorX1MK2.shiftPressed) {
        engine.setValue(field.group, "eject", field.value);
    } else {
        engine.setValue(field.group, "LoadSelectedTrack", field.value);
    }
};

TraktorX1MK2.syncButton = function(field) {
    var now = Date.now();
    var group = field.group;
    TraktorX1MK2.syncPressed[group] = field.value > 0;

    // If shifted, make this channel explicit master.
    if (TraktorX1MK2.shiftPressed) {
        if (TraktorX1MK2.syncPressed[group]) {
            var sync_master = engine.getValue(group, "sync_master");
            engine.setValue(group, "sync_master", !sync_master);
            TraktorX1MK2.displayBpm(group);
        } else {
            TraktorX1MK2.displayBeatjumpSize(group);
        }
    } else {
        if (TraktorX1MK2.syncPressed[group]) {
            TraktorX1MK2.syncEnabledTime[group] = now;
            TraktorX1MK2.displayBpm(group);
        } else {
            if (engine.getValue(group, "sync_enabled")) {
                // was enabled, and button has been let go.  maybe latch it.
                engine.setValue(group, "sync_enabled", 0);
            } else {
                if (!TraktorX1MK2.rateModified &&
                    ((now - TraktorX1MK2.syncEnabledTime[group]) > 300)) {
                    engine.setValue(group, "sync_enabled", 1);
                }
                TraktorX1MK2.rateModified = false;
            }
            TraktorX1MK2.displayLoopSize(group);
        }
    }
};

TraktorX1MK2.cueButton = function(field) {
    if (TraktorX1MK2.shiftPressed) {
        if (ShiftCueButtonAction === "REWIND") {
            if (field.value === 0) {
                return;
            }
            engine.setValue(field.group, "start_stop", 1);
        } else if (ShiftCueButtonAction === "REVERSEROLL") {
            engine.setValue(field.group, "reverseroll", field.value);
        }
    } else {
        engine.setValue(field.group, "cue_default", field.value);
    }
};

TraktorX1MK2.playButton = function(field) {
    if (field.value === 0) {
        return;
    }
    if (TraktorX1MK2.shiftPressed) {
        var locked = engine.getValue(field.group, "keylock");
        engine.setValue(field.group, "keylock", !locked);
    } else {
        var playing = engine.getValue(field.group, "play");
        var deckNumber = TraktorX1MK2.controller.resolveDeck(field.group);
        // Failsafe to disable scratching in case the finishStripeTouch timer has not executed yet
        // after a backspin.
        if (engine.isScratching(deckNumber)) {
            engine.scratchDisable(deckNumber, false);
        }
        engine.setValue(field.group, "play", !playing);
    }
};

TraktorX1MK2.finishStripeCenterTouch = function(timestamp) {
    TraktorX1MK2.stripeCenterPressTimer = 0;
    TraktorX1MK2.stripeCenterPressed = false;
    var previousTime = TraktorX1MK2.stripeCenterPressTime;
    if (previousTime > timestamp) {
    // We looped around.  Adjust current time so that subtraction works.
        timestamp += 0x10000;
    }
    var timeDelta = timestamp - previousTime;
    if (timeDelta >= 0x0200) {
        // A long center press currently has no extra action.
    }
}

TraktorX1MK2.stripeTouchTimestamp = function(field) {
    TraktorX1MK2.stripeTouchTime = field.value;
}

TraktorX1MK2.stripeTouch = function(field) {
    var timestamp = TraktorX1MK2.stripeTouchTime;
    var group = "[Master]";
    var value = field.value;
    var index = -1;

    if (field.name[13] === "0") {
        index = 0;
    } else if (field.name[13] === "1") {
        index = 1;
    }
    if ((index < 0) && (index >= TraktorX1MK2.lastTouchChannel.length)) {
        return;
    }
    if (value === 0x0000) {
        TraktorX1MK2.stripeTouchRelease(index);
    } else if (value <= 0x01C0) {
        TraktorX1MK2.lastTouchChannel[index] = 0;
        value = 0x01C0 - value;
    } else if (value < 0x0240) {
        TraktorX1MK2.stripeTouchRelease(index);
        if (!TraktorX1MK2.stripeCenterPressed) {
            TraktorX1MK2.stripeCenterPressed = true;
            TraktorX1MK2.stripeCenterPressTime = timestamp;
        }
        if (TraktorX1MK2.stripeCenterPressTimer !== 0) {
            engine.stopTimer(TraktorX1MK2.stripeCenterPressTimer);
        }
        TraktorX1MK2.stripeCenterPressTimer = engine.beginTimer(TraktorX1MK2.stripePressTimeoutMilliseconds,
                                                           function() {
                    TraktorX1MK2.finishStripeCenterTouch(timestamp);
                }, true);
    } else if (value <= 0x0400) {
        TraktorX1MK2.lastTouchChannel[index] = 1;
        value = 0x0400 - value;
    } else {
        TraktorX1MK2.stripeTouchRelease(index);
    }
    var channelIndex = TraktorX1MK2.lastTouchChannel[index];
    if ((channelIndex >= 0) &&
        (channelIndex < TraktorX1MK2.lastTickValue.length)) {
        if (TraktorX1MK2.lastTickValue[channelIndex] === 0) {
            TraktorX1MK2.lastTickValue[channelIndex] = value;
        } else {
            group = "[Channel" + (channelIndex + 1) + "]";
        }
    }
    if (group !== "[Master]") {
        var deltas = TraktorX1MK2.stripeDeltas(group, value, timestamp);
        var tickDelta = deltas[0];
        var timeDelta = deltas[1];

        if (engine.getValue(group, "scratch2_enable")) {
            var deckNumber = TraktorX1MK2.controller.resolveDeck(group);
            if (TraktorX1MK2.shiftPressed) {
                tickDelta *= 10;
            }
            engine.scratchTick(deckNumber, tickDelta);
        } else {
            var velocity = TraktorX1MK2.scalerStripe(tickDelta, timeDelta, group);
            engine.setValue(group, "jog", velocity);
        }
    }
};

TraktorX1MK2.stripeTouchRelease = function(index) {
    var channelIndex = TraktorX1MK2.lastTouchChannel[index];
    if ((channelIndex >= 0) &&
        (channelIndex < TraktorX1MK2.lastTickValue.length)) {
        TraktorX1MK2.lastTickValue[channelIndex] = 0;
    }
    TraktorX1MK2.lastTouchChannel[index] = -1;
}

TraktorX1MK2.stripeDeltas = function(group, value, timestamp) {
    let previousTick;
    let previousTime;

    if (group[8] === "1" || group[8] === "3") {
        previousTick = TraktorX1MK2.lastTickValue[0];
        previousTime = TraktorX1MK2.lastTickTime[0];
        TraktorX1MK2.lastTickValue[0] = value;
        TraktorX1MK2.lastTickTime[0] = timestamp;
    } else {
        previousTick = TraktorX1MK2.lastTickValue[1];
        previousTime = TraktorX1MK2.lastTickTime[1];
        TraktorX1MK2.lastTickValue[1] = value;
        TraktorX1MK2.lastTickTime[1] = timestamp;
    }

    if (previousTime > timestamp) {
    // We looped around.  Adjust current time so that subtraction works.
        timestamp += 0x10000;
    }
    var timeDelta = timestamp - previousTime;
    if (timeDelta === 0) {
    // Spinning too fast to detect speed!  By not dividing we are guessing it took 1ms.
        timeDelta = 1;
    }

    let tickDelta;
    if (previousTick >= 400 && value <= 100) {
        tickDelta = value + 448 - previousTick;
    } else if (previousTick <= 100 && value >= 400) {
        tickDelta = value - previousTick - 448;
    } else {
        tickDelta = value - previousTick;
    }
    //HIDDebug(group + " " + value + " " + previousTick + " " + tickDelta);
    return [tickDelta, timeDelta];
};

TraktorX1MK2.scalerStripe = function(tickDelta, timeDelta, group) {
    if (engine.getValue(group, "play")) {
        return (tickDelta / timeDelta) / 3;
    } else {
        return (tickDelta / timeDelta) * 2.25;
    }
};

var introOutroKeys = [
    "intro_start",
    "intro_end",
    "outro_start",
    "outro_end"
];

var introOutroColors = [
    {red: 0, green: ButtonBrightnessOn, blue: 0},
    {red: 0, green: ButtonBrightnessOn, blue: 0},
    {red: ButtonBrightnessOn, green: 0, blue: 0},
    {red: ButtonBrightnessOn, green: 0, blue: 0}
];

var introOutroColorsDim = [
    {red: 0, green: ButtonBrightnessOff, blue: 0},
    {red: 0, green: ButtonBrightnessOff, blue: 0},
    {red: ButtonBrightnessOff, green: 0, blue: 0},
    {red: ButtonBrightnessOff, green: 0, blue: 0}
];


TraktorX1MK2.setPadMode = function(group, padMode) {
    TraktorX1MK2.padConnections[group].forEach(function(connection) {
        connection.disconnect();
    });
    TraktorX1MK2.padConnections[group] = [];

    if (padMode === TraktorX1MK2.padModes.hotcue) {
        for (var i = 1; i <= 4; i++) {
            TraktorX1MK2.padConnections[group].push(
                engine.makeConnection(group, "hotcue_" + i + "_enabled", TraktorX1MK2.outputHotcueCallback));
            TraktorX1MK2.padConnections[group].push(
                engine.makeConnection(group, "hotcue_" + i + "_color", TraktorX1MK2.outputHotcueCallback));
        }
    } else if (padMode === TraktorX1MK2.padModes.introOutro) {
        for (i = 1; i <= 4; i++) {
            // This function to create callback functions is needed so the loop index variable
            // i does not get captured in a closure within the callback.
            var makeIntroOutroCallback = function(padNumber) {
                return function(value, group, _control) {
                    if (value > 0) {
                        TraktorX1MK2.sendPadColor(group, padNumber, introOutroColors[padNumber-1]);
                    } else {
                        TraktorX1MK2.sendPadColor(group, padNumber, introOutroColorsDim[padNumber-1]);
                    }
                };
            };
            TraktorX1MK2.padConnections[group].push(engine.makeConnection(
                group, introOutroKeys[i-1] + "_enabled", makeIntroOutroCallback(i)));
        }
    } else if (padMode === TraktorX1MK2.padModes.sampler) {
        for (i = 1; i <= 4; i++) {
            var makeSamplerCallback = function(deckGroup, padNumber) {
                var samplerNumber = deckGroup === "[Channel1]" ? padNumber : padNumber + 4;
                var samplerGroup = "[Sampler" + samplerNumber + "]";
                return function(_value, _group, _control) {
                    if (engine.getValue(samplerGroup, "track_loaded")) {
                        if (engine.getValue(samplerGroup, "play") === 1) {
                            if (engine.getValue(samplerGroup, "repeat") === 1) {
                                TraktorX1MK2.sendPadColor(deckGroup, padNumber,
                                    {red: 0x7f, green: 0x7f, blue: 0});
                            } else {
                                TraktorX1MK2.sendPadColor(deckGroup, padNumber,
                                    {red: 0xAF, green: 0x00, blue: 0xCC});
                            }
                        } else {
                            TraktorX1MK2.sendPadColor(deckGroup, padNumber, {red: 0x7f, green: 0x7f, blue: 0x7f});
                        }
                    } else {
                        TraktorX1MK2.sendPadColor(deckGroup, padNumber, {red: 0, green: 0, blue: 0});
                    }
                };
            };

            var sNumber = group === "[Channel1]" ? i : i + 4;
            var sGroup = "[Sampler" + sNumber + "]";
            TraktorX1MK2.padConnections[group].push(engine.makeConnection(
                sGroup, "track_loaded", makeSamplerCallback(group, i)));
            TraktorX1MK2.padConnections[group].push(engine.makeConnection(
                sGroup, "play", makeSamplerCallback(group, i)));
            TraktorX1MK2.padConnections[group].push(engine.makeConnection(
                sGroup, "repeat", makeSamplerCallback(group, i)));
        }
    }

    TraktorX1MK2.padConnections[group].forEach(function(connection) {
        connection.trigger();
    });

    TraktorX1MK2.currentPadMode[group] = padMode;
};

TraktorX1MK2.hotcueButton = function(buttonNumber, group, value) {
    if (TraktorX1MK2.shiftPressed) {
        engine.setValue(group, "hotcue_" + buttonNumber + "_clear", value);
    } else {
        engine.setValue(group, "hotcue_" + buttonNumber + "_activate", value);
    }
};

TraktorX1MK2.introOutroButton = function(buttonNumber, group, value) {
    if (TraktorX1MK2.shiftPressed) {
        engine.setValue(group, introOutroKeys[buttonNumber-1] + "_clear", value);
    } else {
        engine.setValue(group, introOutroKeys[buttonNumber-1] + "_activate", value);
    }
};

TraktorX1MK2.samplerButton = function(buttonNumber, group, value) {
    if (value === 0) {
        return;
    }
    var samplerNumber = group === "[Channel1]" ? buttonNumber : buttonNumber + 4;
    var samplerGroup = "[Sampler" + samplerNumber + "]";
    if (TraktorX1MK2.shiftPressed) {
        if (engine.getValue(samplerGroup, "play") === 1) {
            engine.setValue(samplerGroup, "play", 0);
        } else {
            script.triggerControl(samplerGroup, "eject");
        }
    } else {
        if (engine.getValue(samplerGroup, "track_loaded") === 0) {
            script.triggerControl(samplerGroup, "LoadSelectedTrack");
        } else {
            script.triggerControl(samplerGroup, "cue_gotoandplay");
        }
    }
};

TraktorX1MK2.padButton = function(field) {
    var buttonNumber = parseInt(field.name[field.name.length - 1]);
    var padMode = TraktorX1MK2.currentPadMode[field.group];

    if (padMode === TraktorX1MK2.padModes.hotcue) {
        TraktorX1MK2.hotcueButton(buttonNumber, field.group, field.value);
    } else if (padMode === TraktorX1MK2.padModes.introOutro) {
        TraktorX1MK2.introOutroButton(buttonNumber, field.group, field.value);
    } else if (padMode === TraktorX1MK2.padModes.sampler) {
        TraktorX1MK2.samplerButton(buttonNumber, field.group, field.value);
    }
};

TraktorX1MK2.introOutroModeButton = function(field) {
    if (field.value === 0) {
        return;
    }
    if (TraktorX1MK2.shiftPressed) {
         TraktorX1MK2.switchEffectUnitMode(!TraktorX1MK2.effectUnitMixerControl);
    } else {
        var padMode = TraktorX1MK2.currentPadMode[field.group];
        if (padMode !== TraktorX1MK2.padModes.introOutro) {
            TraktorX1MK2.setPadMode(field.group, TraktorX1MK2.padModes.introOutro);
            TraktorX1MK2.controller.setOutput(field.group, "!flux_button", ButtonBrightnessOn, !TraktorX1MK2.batchingLEDUpdate);
        } else {
            TraktorX1MK2.setPadMode(field.group, TraktorX1MK2.padModes.hotcue);
            TraktorX1MK2.controller.setOutput(field.group, "!flux_button", ButtonBrightnessOff, !TraktorX1MK2.batchingLEDUpdate);
        }
    }
};

TraktorX1MK2.connectEffectFocusButtonLEDs = function(effectUnitGroup) {
    if (TraktorX1MK2.effectFocusButtonLEDconnections[effectUnitGroup]) {
        TraktorX1MK2.effectFocusButtonLEDconnections[effectUnitGroup].disconnect();
    }

    var effectFocusButtonLEDcallback = function(value, _group, _control) {
        TraktorX1MK2.controller.setOutput(effectUnitGroup, "!effect_focus_button",
            value === 1 ? ButtonBrightnessOn : ButtonBrightnessOff, !TraktorX1MK2.batchingLEDUpdate);
    };

    var buttonControl = "pfl";
    var filterUnitGroup = "[Master]";
    if (TraktorX1MK2.shiftPressed) {
        buttonControl = "enabled";
        if (effectUnitGroup === "[EffectRack1_EffectUnit1]") {
            filterUnitGroup = "[QuickEffectRack1_[Channel1]_Effect1]";
        } else if (effectUnitGroup === "[EffectRack1_EffectUnit2]") {
            filterUnitGroup = "[QuickEffectRack1_[Channel2]_Effect1]";
        }
    } else {
        if (effectUnitGroup === "[EffectRack1_EffectUnit1]") {
            filterUnitGroup = "[Channel1]";
        } else if (effectUnitGroup === "[EffectRack1_EffectUnit2]") {
            filterUnitGroup = "[Channel2]";
        }
    }
    TraktorX1MK2.effectFocusButtonLEDconnections[effectUnitGroup] = engine.makeConnection(
            filterUnitGroup, buttonControl, effectFocusButtonLEDcallback);
    TraktorX1MK2.effectFocusButtonLEDconnections[effectUnitGroup].trigger();
};

// Refer to https://github.com/mixxxdj/mixxx/wiki/standard-effects-mapping for how to use this.
TraktorX1MK2.connectEffectButtonLEDs = function(effectUnitGroup) {
    TraktorX1MK2.effectButtonLEDconnections[effectUnitGroup].forEach(function(connection) {
        connection.disconnect();
    });

    var focusedEffect = engine.getValue(effectUnitGroup, "focused_effect");
    var makeButtonLEDcallback = function(effectNumber) {
        return function(value, _group, _control) {
            TraktorX1MK2.controller.setOutput(effectUnitGroup, "!effectbutton" + effectNumber,
                value === 1 ? ButtonBrightnessOn : ButtonBrightnessOff, !TraktorX1MK2.batchingLEDUpdate);
        };
    };

    TraktorX1MK2.batchingLEDUpdate = true;
    if (TraktorX1MK2.effectUnitMixerControl) {
        var filterUnitGroup = "[Master]";
        if (effectUnitGroup === "[EffectRack1_EffectUnit1]") {
            filterUnitGroup = "[EqualizerRack1_[Channel1]_Effect1]";
        } else if (effectUnitGroup === "[EffectRack1_EffectUnit2]") {
            filterUnitGroup = "[EqualizerRack1_[Channel2]_Effect1]";
        }
        for (let i = 0; i <= 2; i++) {
            TraktorX1MK2.effectButtonLEDconnections[effectUnitGroup][i] = engine.makeConnection(
                filterUnitGroup, "button_parameter" + (3 - i), makeButtonLEDcallback(i+1));
            TraktorX1MK2.effectButtonLEDconnections[effectUnitGroup][i].trigger();
        }
    } else {
        // FIXME: Why do the LEDs flicker?
        for (let i = 0; i <= 2; i++) {
            let effectGroup;
            var key;
            if (focusedEffect === 0) {
                effectGroup = effectUnitGroup.slice(0, -1) + "_Effect" + (i+1) + "]";
                key = "enabled";
            } else {
                effectGroup = effectUnitGroup.slice(0, -1) + "_Effect" + focusedEffect + "]";
                key = "button_parameter" + (i+1);
            }
            TraktorX1MK2.effectButtonLEDconnections[effectUnitGroup][i] = engine.makeConnection(
                effectGroup, key, makeButtonLEDcallback(i+1));
            TraktorX1MK2.effectButtonLEDconnections[effectUnitGroup][i].trigger();
        }
    }
    TraktorX1MK2.batchingLEDUpdate = false;
    TraktorX1MK2.effectButtonLEDconnections[effectUnitGroup][2].trigger();
};

// Refer to https://github.com/mixxxdj/mixxx/wiki/standard-effects-mapping for how to use this.
TraktorX1MK2.onShowParametersChange = function(value, group, _control) {
    if (value === 0) {
        if (engine.getValue(group, "show_focus") > 0) {
            engine.setValue(group, "show_focus", 0);
            TraktorX1MK2.previouslyFocusedEffect[group] = engine.getValue(group, "focused_effect");
            engine.setValue(group, "focused_effect", 0);
        }
    } else {
        engine.setValue(group, "show_focus", 1);
        if (TraktorX1MK2.previouslyFocusedEffect[group] !== null) {
            engine.setValue(group, "focused_effect", TraktorX1MK2.previouslyFocusedEffect[group]);
        }
    }
    if (!TraktorX1MK2.effectUnitMixerControl) {
        TraktorX1MK2.connectEffectButtonLEDs(group);
    }
};

// Refer to https://github.com/mixxxdj/mixxx/wiki/standard-effects-mapping for how to use this.
TraktorX1MK2.onFocusedEffectChange = function(value, group, _control) {
    if (!TraktorX1MK2.effectUnitMixerControl) {
        TraktorX1MK2.controller.setOutput(group, "!effect_focus_button",
                                          value > 0 ? ButtonBrightnessOn : ButtonBrightnessOff,
                                          !TraktorX1MK2.batchingLEDUpdate);
    }
    if (value === 0) {
        for (var i = 1; i <= 2; i++) {
            // The previously focused effect is not available here, so iterate over all effects' parameter knobs.
            for (var j = 1; j < 3; j++) {
                engine.softTakeoverIgnoreNextValue(group.slice(0, -1) + "_Effect" + i + "]", "parameter" + j);
            }
        }
    } else {
        for (i = 1; i <= 2; i++) {
            engine.softTakeoverIgnoreNextValue(group.slice(0, -1) + "_Effect" + i + "]", "meta");
        }
    }
};

TraktorX1MK2.switchEffectUnitMode = function(mixerControlEnabled) {
    TraktorX1MK2.effectUnitMixerControl = mixerControlEnabled;
    if (TraktorX1MK2.effectUnitMixerControl) {
        TraktorX1MK2.connectEffectFocusButtonLEDs("[EffectRack1_EffectUnit1]");
        TraktorX1MK2.connectEffectFocusButtonLEDs("[EffectRack1_EffectUnit2]");
    } else {
        if (TraktorX1MK2.effectFocusButtonLEDconnections["[EffectRack1_EffectUnit1]"]) {
            TraktorX1MK2.effectFocusButtonLEDconnections["[EffectRack1_EffectUnit1]"].disconnect();
            TraktorX1MK2.effectFocusButtonLEDconnections["[EffectRack1_EffectUnit1]"] = null;
        }
        if (TraktorX1MK2.effectFocusButtonLEDconnections["[EffectRack1_EffectUnit2]"]) {
            TraktorX1MK2.effectFocusButtonLEDconnections["[EffectRack1_EffectUnit2]"].disconnect();
            TraktorX1MK2.effectFocusButtonLEDconnections["[EffectRack1_EffectUnit2]"] = null;
        }
        TraktorX1MK2.controller.setOutput("[EffectRack1_EffectUnit1]", "!effect_focus_button",
                                          engine.getValue("[EffectRack1_EffectUnit1]", "focused_effect") > 0 ?
                                          ButtonBrightnessOn : ButtonBrightnessOff,
                                          !TraktorX1MK2.batchingLEDUpdate);
        TraktorX1MK2.controller.setOutput("[EffectRack1_EffectUnit2]", "!effect_focus_button",
                                          engine.getValue("[EffectRack1_EffectUnit2]", "focused_effect") > 0 ?
                                          ButtonBrightnessOn : ButtonBrightnessOff,
                                          !TraktorX1MK2.batchingLEDUpdate);
    }
    TraktorX1MK2.connectEffectButtonLEDs("[EffectRack1_EffectUnit1]");
    TraktorX1MK2.connectEffectButtonLEDs("[EffectRack1_EffectUnit2]");
    TraktorX1MK2.controller.setOutput("[EffectRack1_EffectUnit1]", "!arrow_left",
                                      TraktorX1MK2.effectUnitMixerControl ?
                                      0x00 : OutputBrightnessMax,
                                      !TraktorX1MK2.batchingLEDUpdate);
    TraktorX1MK2.controller.setOutput("[EffectRack1_EffectUnit2]", "!arrow_right",
                                      TraktorX1MK2.effectUnitMixerControl ?
                                      0x00 : OutputBrightnessMax,
                                      !TraktorX1MK2.batchingLEDUpdate);
}

TraktorX1MK2.effectMixKnob = function(field) {
    var effectUnitGroup = field.group;

    if (TraktorX1MK2.effectUnitMixerControl) {
        var knobControl = "volume";
        var filterUnitGroup = "[Master]";
        if (TraktorX1MK2.shiftPressed) {
            knobControl = "super1";
            if (effectUnitGroup === "[EffectRack1_EffectUnit1]") {
                filterUnitGroup = "[QuickEffectRack1_[Channel1]]";
            } else if (effectUnitGroup === "[EffectRack1_EffectUnit2]") {
                filterUnitGroup = "[QuickEffectRack1_[Channel2]]";
            }
        } else {
            if (effectUnitGroup === "[EffectRack1_EffectUnit1]") {
                filterUnitGroup = "[Channel1]";
            } else if (effectUnitGroup === "[EffectRack1_EffectUnit2]") {
                filterUnitGroup = "[Channel2]";
            }
        }
        engine.setParameter(filterUnitGroup, knobControl, field.value / 4096);
    } else {
        engine.setParameter(effectUnitGroup, "mix", field.value / 4096);
    }
};

// Refer to https://github.com/mixxxdj/mixxx/wiki/standard-effects-mapping for how to use this.
TraktorX1MK2.effectFocusButton = function(field) {
    var showParameters = engine.getValue(field.group, "show_parameters");

    if (TraktorX1MK2.effectUnitMixerControl) {
        if (field.value > 0) {
            var filterUnitGroup = "[Master]";
            if (TraktorX1MK2.shiftPressed) {
                if (field.group === "[EffectRack1_EffectUnit1]") {
                    filterUnitGroup = "[QuickEffectRack1_[Channel1]_Effect1]";
                } else if (field.group === "[EffectRack1_EffectUnit2]") {
                    filterUnitGroup = "[QuickEffectRack1_[Channel2]_Effect1]";
                }
                engine.setValue(filterUnitGroup, "enabled",
                                !engine.getValue(filterUnitGroup, "enabled"));
            } else {
                if (field.group === "[EffectRack1_EffectUnit1]") {
                    filterUnitGroup = "[Channel1]";
                } else if (field.group === "[EffectRack1_EffectUnit2]") {
                    filterUnitGroup = "[Channel2]";
                }
                engine.setValue(filterUnitGroup, "pfl",
                                !engine.getValue(filterUnitGroup, "pfl"));
            }
        }
    } else {
        if (field.value > 0) {
            if (TraktorX1MK2.shiftPressed) {
                engine.setValue(field.group, "loaded_chain_preset", 1);
                return;
            }
            TraktorX1MK2.effectFocusLongPressTimer[field.group] = engine.beginTimer(TraktorX1MK2.longPressTimeoutMilliseconds, function() {
                TraktorX1MK2.effectFocusChooseModeActive[field.group] = true;
                TraktorX1MK2.effectButtonLEDconnections[field.group].forEach(function(connection) {
                    connection.disconnect();
                });
                var makeButtonLEDcallback = function(buttonNumber) {
                    return function(value, group, _control) {
                        TraktorX1MK2.controller.setOutput(group, "!effectbutton" + buttonNumber,
                            value === buttonNumber ? ButtonBrightnessOn : ButtonBrightnessOff, !TraktorX1MK2.batchingLEDUpdate);
                    };
                };
                TraktorX1MK2.batchingLEDUpdate = true;
                for (var i = 0; i <= 2; i++) {
                    TraktorX1MK2.effectButtonLEDconnections[i] = engine.makeConnection(
                        field.group, "focused_effect", makeButtonLEDcallback(i + 1));
                    TraktorX1MK2.effectButtonLEDconnections[i].trigger();
                }
                TraktorX1MK2.batchingLEDUpdate = false;
                TraktorX1MK2.effectButtonLEDconnections[2].trigger();
            });
            if (!showParameters) {
                engine.setValue(field.group, "show_parameters", 1);
                TraktorX1MK2.effectFocusButtonPressedWhenParametersHidden[field.group] = true;
            }
        } else {
            if (TraktorX1MK2.effectFocusLongPressTimer[field.group] !== 0) {
                engine.stopTimer(TraktorX1MK2.effectFocusLongPressTimer[field.group]);
                TraktorX1MK2.effectFocusLongPressTimer[field.group] = 0;
            }

            if (TraktorX1MK2.effectFocusChooseModeActive[field.group]) {
                TraktorX1MK2.effectFocusChooseModeActive[field.group] = false;
                TraktorX1MK2.connectEffectButtonLEDs(field.group);
            } else if (showParameters && !TraktorX1MK2.effectFocusButtonPressedWhenParametersHidden[field.group]) {
                engine.setValue(this.group, "show_parameters", 0);
            }

            TraktorX1MK2.effectFocusButtonPressedWhenParametersHidden[field.group] = false;
        }
    }
};

// Refer to https://github.com/mixxxdj/mixxx/wiki/standard-effects-mapping for how to use this.
TraktorX1MK2.effectKnob = function(field) {
    var knobNumber = parseInt(field.id.slice(-1));
    var effectUnitGroup = field.group;

    if (TraktorX1MK2.effectUnitMixerControl) {
        var filterUnitGroup = "[EqualizerRack1_[Master]_Effect1]";
        if (effectUnitGroup === "[EffectRack1_EffectUnit1]") {
            filterUnitGroup = "[EqualizerRack1_[Channel1]_Effect1]";
        } else if (effectUnitGroup === "[EffectRack1_EffectUnit2]") {
            filterUnitGroup = "[EqualizerRack1_[Channel2]_Effect1]";
        }
        engine.setParameter(filterUnitGroup, "parameter" + (4 - knobNumber), field.value / 4096);
    } else {
        var focusedEffect = engine.getValue(effectUnitGroup, "focused_effect");
        if (focusedEffect > 0) {
            engine.setParameter(effectUnitGroup.slice(0, -1) + "_Effect" + focusedEffect + "]",
                "parameter" + knobNumber,
                field.value / 4096);
        } else {
            engine.setParameter(effectUnitGroup.slice(0, -1) + "_Effect" + knobNumber + "]",
                "meta",
                field.value / 4096);
        }
    }
};

// Refer to https://github.com/mixxxdj/mixxx/wiki/standard-effects-mapping for how to use this.
TraktorX1MK2.effectButton = function(field) {
    var buttonNumber = parseInt(field.id.slice(-1));
    var effectUnitGroup = field.group;
    var focusedEffect = engine.getValue(effectUnitGroup, "focused_effect");

    if (TraktorX1MK2.effectUnitMixerControl) {
        if (field.value > 0) {
            var buttonControl = "button_parameter" + (4 - buttonNumber);
            var filterUnitGroup = "[Master]";
            if (effectUnitGroup === "[EffectRack1_EffectUnit1]") {
                filterUnitGroup = "[EqualizerRack1_[Channel1]_Effect1]";
            } else if (effectUnitGroup === "[EffectRack1_EffectUnit2]") {
                filterUnitGroup = "[EqualizerRack1_[Channel2]_Effect1]";
            }
            engine.setValue(filterUnitGroup, buttonControl,
                            !engine.getValue(filterUnitGroup, buttonControl));
        }
    } else {
        var toggle = function() {
            var group;
            var key;
            if (focusedEffect === 0) {
                group = effectUnitGroup.slice(0, -1) + "_Effect" + buttonNumber + "]";
                key = "enabled";
            } else {
                group = effectUnitGroup.slice(0, -1) + "_Effect" + focusedEffect + "]";
                key = "button_parameter" + buttonNumber;
            }
            script.toggleControl(group, key);
        };

        if (field.value > 0) {
            if (TraktorX1MK2.shiftPressed) {
                engine.setValue(effectUnitGroup, "loaded_chain_preset", buttonNumber+1);
            } else {
                if (TraktorX1MK2.effectFocusChooseModeActive[effectUnitGroup]) {
                    if (focusedEffect === buttonNumber) {
                        engine.setValue(effectUnitGroup, "focused_effect", 0);
                    } else {
                        engine.setValue(effectUnitGroup, "focused_effect", buttonNumber);
                    }
                    TraktorX1MK2.effectFocusChooseModeActive[effectUnitGroup] = false;
                } else {
                    toggle();
                    TraktorX1MK2.effectButtonLongPressTimer[effectUnitGroup][buttonNumber] =
              engine.beginTimer(TraktorX1MK2.longPressTimeoutMilliseconds,
                  function() {
                      TraktorX1MK2.effectButtonIsLongPressed[effectUnitGroup][buttonNumber] = true;
                      TraktorX1MK2.effectButtonLongPressTimer[effectUnitGroup][buttonNumber] = 0;
                  },
                  true
              );
                }
            }
        } else {
            engine.stopTimer(TraktorX1MK2.effectButtonLongPressTimer[effectUnitGroup][buttonNumber]);
            TraktorX1MK2.effectButtonLongPressTimer[effectUnitGroup][buttonNumber] = 0;
            if (TraktorX1MK2.effectButtonIsLongPressed[effectUnitGroup][buttonNumber]) {
                toggle();
            }
            TraktorX1MK2.effectButtonIsLongPressed[effectUnitGroup][buttonNumber] = false;
        }
    }
};

/// return value 1 === right turn
/// return value -1 === left turn
TraktorX1MK2.encoderDirection = function(newValue, oldValue) {
    let direction;
    var min = 0;
    var max = 15;
    if (oldValue === max && newValue === min) {
        direction = 1;
    } else if (oldValue === min && newValue === max) {
        direction = -1;
    } else if (newValue > oldValue) {
        direction = 1;
    } else {
        direction = -1;
    }
    return direction;
};

TraktorX1MK2.deckEncoder = function(field) {
    var group = field.group;
    var delta = TraktorX1MK2.encoderDirection(field.value, TraktorX1MK2.previousDeckEncoder[group]);
    TraktorX1MK2.previousDeckEncoder[group] = field.value;

    if (TraktorX1MK2.syncPressed[group]) {
        if (delta === 1) {
            script.triggerControl(group, TraktorX1MK2.deckEncoderPressed[group] ?
                                  "rate_perm_up" : "rate_perm_up_small");
        } else {
            script.triggerControl(group, TraktorX1MK2.deckEncoderPressed[group] ?
                                  "rate_perm_down" : "rate_perm_down_small");
        }
        TraktorX1MK2.rateModified = true;
    } else {
        if (TraktorX1MK2.shiftPressed) {
            if (TraktorX1MK2.deckEncoderPressed[group]) {
                var beatjumpSize = engine.getValue(group, "beatjump_size");
                if (delta === 1) {
                    beatjumpSize *= 2;
                } else {
                    beatjumpSize /= 2;
                }
                engine.setValue(group, "beatjump_size", beatjumpSize);
            } else {
                if (delta === 1) {
                    script.triggerControl(group, "beatjump_forward");
                } else {
                    script.triggerControl(group, "beatjump_backward");
                }
            }
        } else {
            if (delta === 1) {
                script.triggerControl(group, "loop_double");
            } else {
                script.triggerControl(group, "loop_halve");
            }
        }
    }
};

TraktorX1MK2.deckEncoderPress = function(field) {
    var now = Date.now();
    var group = field.group;
    var loopEnabled = engine.getValue(group, "loop_enabled");
    TraktorX1MK2.deckEncoderPressed[group] = (field.value > 0);

    if (TraktorX1MK2.deckEncoderPressed[group]) {
        if (TraktorX1MK2.syncPressed[group]) {
            TraktorX1MK2.rateResetTime[group] = now;
        } else {
            if (!TraktorX1MK2.shiftPressed) {
                if (loopEnabled) {
                    script.triggerControl(group, "reloop_toggle");
                } else {
                    script.triggerControl(group, "beatloop_activate");
                }
            }
        }
    } else {
        if (TraktorX1MK2.syncPressed[group] &&
            ((now - TraktorX1MK2.rateResetTime[group]) <= 300)) {
            engine.setValue(group, "rate", 0);
            TraktorX1MK2.rateModified = true;
        }
    }
};

TraktorX1MK2.browseEncoder = function(field) {
    var delta = TraktorX1MK2.encoderDirection(field.value, TraktorX1MK2.previousBrowse);
    TraktorX1MK2.previousBrowse = field.value;

    if (TraktorX1MK2.shiftPressed) {
        engine.setValue("[Playlist]", "SelectPlaylist", delta);
    } else {
        engine.setValue("[Playlist]", "SelectTrackKnob", delta);
    }
};

TraktorX1MK2.browsePress = function(field) {
    TraktorX1MK2.browsePressed = (field.value > 0);

    if (TraktorX1MK2.browsePressed) {
        if (TraktorX1MK2.shiftPressed) {
            script.triggerControl("[Playlist]", "ToggleSelectedSidebarItem");
        } else {
            script.toggleControl("[Master]", "maximize_library");
        }
    }
};

TraktorX1MK2.scalerParameter = function(group, name, value) {
    return script.absoluteLin(value, 0, 1, 16, 4080);
};

TraktorX1MK2.outputChannelCallback = function(value, group, key) {
    var ledValue = 0x05;
    if (value) {
        ledValue = ButtonBrightnessOn;
    }
    TraktorX1MK2.controller.setOutput(group, key, ledValue, !TraktorX1MK2.batchingLEDUpdate);
};

TraktorX1MK2.outputChannelCallbackDark = function(value, group, key) {
    var ledValue = 0x00;
    if (value) {
        ledValue = ButtonBrightnessOn;
    }
    TraktorX1MK2.controller.setOutput(group, key, ledValue, !TraktorX1MK2.batchingLEDUpdate);
};

TraktorX1MK2.outputCallback = function(value, group, key) {
    var ledValue = ButtonBrightnessOff;
    if (value) {
        ledValue = ButtonBrightnessOn;
    }
    TraktorX1MK2.controller.setOutput(group, key, ledValue, !TraktorX1MK2.batchingLEDUpdate);
};

TraktorX1MK2.outputCallbackLoop = function(value, group, key) {
    var ledValue = ButtonBrightnessOff;
    if (engine.getValue(group, "loop_enabled")) {
        ledValue = ButtonBrightnessOn;
    }
    TraktorX1MK2.controller.setOutput(group, key, ledValue, !TraktorX1MK2.batchingLEDUpdate);
};

TraktorX1MK2.outputCallbackDark = function(value, group, key) {
    var ledValue = 0x00;
    if (value) {
        ledValue = ButtonBrightnessOn;
    }
    TraktorX1MK2.controller.setOutput(group, key, ledValue, !TraktorX1MK2.batchingLEDUpdate);
};

TraktorX1MK2.sendPadColor = function(group, padNumber, color) {
    var padKey = "!pad_" + padNumber + "_";
    var ColorBrightnessScaler = ButtonBrightnessOn / OutputBrightnessMax;
    var red = color.red * ColorBrightnessScaler;
    var green = color.green * ColorBrightnessScaler;
    var blue = color.blue * ColorBrightnessScaler;
    if (color.red === 0 && color.green === 0 && color.blue === 0) {
        red = ButtonBrightnessOff;
        green = ButtonBrightnessOff;
        blue = ButtonBrightnessOff;
    }
    TraktorX1MK2.controller.setOutput(group, padKey + "R", red, false);
    TraktorX1MK2.controller.setOutput(group, padKey + "G", green, false);
    TraktorX1MK2.controller.setOutput(group, padKey + "B", blue, !TraktorX1MK2.batchingLEDUpdate);
};

TraktorX1MK2.outputHotcueCallback = function(value, group, key) {
    var hotcueNumber = key.charAt(7);
    var color;
    if (engine.getValue(group, "hotcue_" + hotcueNumber + "_enabled")) {
        color = colorCodeToObject(engine.getValue(group, "hotcue_" + hotcueNumber + "_color"));
        // hotcue_X_color reports red, green, and blue on a 0-255 scale, but the controller LEDs
        // only support values 0 - 127.
        color.red /= 2;
        color.green /= 2;
        color.blue /= 2;
    } else {
        color = {red: 0, green: 0, blue: 0};
    }
    TraktorX1MK2.sendPadColor(group, hotcueNumber, color);
};

TraktorX1MK2.displayCharDigit = function(group, charPos, character) {
    // charPost is 0 or 1 for first or second character on the display
    // the display is placed like this:
    // o  -- 4 --
    //   |        |
    //   5        3
    //   |        |
    //    -- 1 --
    //   |        |
    //   6        2
    //   |        |
    //    -- 7 --
    //  Where the numbers respresent each segment of the display
    //  and the dot before it is 0 (but this is dealt with in displayCharDot)

    var numArray = {
        "": [], //empty
        0: [2, 3, 4, 5, 6, 7],
        1: [2, 3],
        2: [1, 3, 4, 6, 7],
        3: [1, 2, 3, 4, 7],
        4: [1, 2, 3, 5],
        5: [4, 5, 1, 2, 7],
        6: [4, 5, 1, 2, 6, 7],
        7: [4, 3, 2],
        8: [1, 2, 3, 4, 5, 6, 7],
        9: [5, 4, 1, 3, 2, 7],
        // Add a few special characters
        "h": [5, 1, 6, 2],
        "n": [6, 1, 2],
        "o": [6, 1, 2, 7],
        "-": [1],
        "b": [5, 6, 7, 2, 1],
        "c": [1, 6, 7],
        "u": [6, 2, 7],
    };

    for (var j = 0; j < 8; j++) {
        var seg = 8 * charPos + j;
        var key = "!display_segment" + seg;
        TraktorX1MK2.controller.setOutput(
            group, key, (numArray[character].indexOf(j) > -1) * OutputBrightnessMax, // if it's in the array turn it on, off otherwise
            !TraktorX1MK2.batchingLEDUpdate);
    }
};

TraktorX1MK2.displayCharDot = function(group, charPos, on) {
    var key = "!display_segment" + 8 * charPos;
    TraktorX1MK2.controller.setOutput(group, key, on * OutputBrightnessMax,
                                      !TraktorX1MK2.batchingLEDUpdate);
};

TraktorX1MK2.sendDisplayMessage = function(group,
                                           firstChar, secondChar, thirdChar,
                                           firstDot, secondDot, thirdDot) {
    TraktorX1MK2.batchingLEDUpdate = true;
    TraktorX1MK2.displayCharDigit(group, 0, firstChar);
    TraktorX1MK2.displayCharDigit(group, 1, secondChar);
    TraktorX1MK2.displayCharDigit(group, 2, thirdChar);
    TraktorX1MK2.displayCharDot(group, 0, firstDot);
    TraktorX1MK2.displayCharDot(group, 1, secondDot);
    TraktorX1MK2.displayCharDot(group, 2, thirdDot);
    TraktorX1MK2.batchingLEDUpdate = false;
    TraktorX1MK2.controller.OutputPackets["outputDisplay"].send();
};

TraktorX1MK2.displayValue = function(group, value) {
    // handle single digit values
    if (value.toString().length === 1) {
        TraktorX1MK2.sendDisplayMessage(group,
                                        "", "", value,
                                        false, false, false);
        // handle values which have fraction part
    } else if (1 > value > 0) {
        var inverse_value = 1 / value;
        if (inverse_value % 1 === 0) {
            if (inverse_value.toString().length === 1) {
                TraktorX1MK2.sendDisplayMessage(group, "", "", inverse_value,
                                                false, false, true);
            } else if (inverse_value.toString().length === 2) {
                TraktorX1MK2.sendDisplayMessage(group,
                                                "",
                                                inverse_value.toString().split("")[0],
                                                inverse_value.toString().split("")[1],
                                                false, true, false);
            } else if (inverse_value.toString().length === 3) {
                TraktorX1MK2.sendDisplayMessage(group,
                                                inverse_value.toString().split("")[0],
                                                inverse_value.toString().split("")[1],
                                                inverse_value.toString().split("")[2],
                                                true, false, false);
            }
        }
        // values with two digits
    } else if (value.toString().length === 2) {
        TraktorX1MK2.sendDisplayMessage(group,
                                        "",
                                        value.toString().split("")[0],
                                        value.toString().split("")[1],
                                        false, false, false);
        // values with three digits
    } else if (value.toString().length === 3) {
        let firstChar = value.toString().split("")[0];
        let secondChar = value.toString().split("")[1];
        let thirdChar = value.toString().split("")[2];
        let thirdDot = false;
        if (secondChar === ".") {
            thirdDot = true;
            thirdChar = secondChar;
            secondChar = firstChar;
            firstChar = "";
        }
        TraktorX1MK2.sendDisplayMessage(group, firstChar, secondChar, thirdChar,
                                        false, false, thirdDot);
        // handle larger values
    } else if (value.toString().length > 3) {
        let firstChar = value.toString().split("")[0];
        let secondChar = value.toString().split("")[1];
        let thirdChar = value.toString().split("")[2];
        let firstDot = true;
        var secondDot = true;
        var thirdDot = true;
        if (thirdChar === ".") {
            firstDot = false;
            secondDot = false;
            thirdChar = value.toString().split("")[3];
        } else if (secondChar === ".") {
            firstDot = false;
            thirdDot = false;
            secondChar = thirdChar;
            thirdChar = value.toString().split("")[3];
        }
        TraktorX1MK2.sendDisplayMessage(group, firstChar, secondChar, thirdChar,
                                        firstDot, secondDot, thirdDot);
    }
}

TraktorX1MK2.displayBpm = function(group) {
    TraktorX1MK2.displayValue(group, engine.getValue(group, "bpm"));
};

TraktorX1MK2.displayLoopSize = function(group) {
    TraktorX1MK2.displayValue(group, engine.getValue(group, "beatloop_size"));
};

TraktorX1MK2.displayBeatjumpSize = function(group) {
    TraktorX1MK2.displayValue(group, engine.getValue(group, "beatjump_size"));
};

TraktorX1MK2.onRateChanged = function(value, group, _key) {
    if (TraktorX1MK2.syncPressed[group]) {
        TraktorX1MK2.displayBpm(group);
    }
};

TraktorX1MK2.onLoopEnabledChanged = function(_value, _group, _key) {
};

TraktorX1MK2.onBeatloopSizeChanged = function(value, group, _key) {
    if (!TraktorX1MK2.syncPressed[group] && !TraktorX1MK2.shiftPressed) {
        TraktorX1MK2.displayLoopSize(group);
    }
};

TraktorX1MK2.onBeatjumpSizeChanged = function(value, group, _key) {
    if (!TraktorX1MK2.syncPressed[group] && TraktorX1MK2.shiftPressed) {
        TraktorX1MK2.displayBeatjumpSize(group);
    }
};