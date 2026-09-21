/*
 * make_AE_gsmovie_simple.jsx
 * Select a template, audio and still image; enter text in a ScriptUI dialog.
 * Creates one .aep without rendering. See AGENTS.md for template requirements.
 */
(function () {
    var COMP_NAME = "gs_template";
    var IMAGE_LAYER_NAME = "Background_Image";
    var AUDIO_LAYER_NAME = "Audio_Source";
    var TEXT_NAMES = ["Category_Genre", "Original_Arrange", "Title"];
    var COLOR_OPTIONS = [
        ["Rock", "#FF0000"], ["HR/HM", "#FF9900"],
        ["EDM", "#FFFF00"], ["Electronic", "#4A86E8"],
        ["Ethnic", "#00FF00"], ["Acoustic", "#00FFFF"],
        ["Jazz", "#0000FE"], ["Orchestra", "#9900FF"],
        ["Pops", "#FC00FC"], ["再翻訳", "#980000"]
    ];
    var logLines = [];

    function main() {
        var templateFile = File.openDialog("テンプレート .aep を選択してください", "*.aep");
        if (!templateFile) { return; }
        var audioFile = File.openDialog("音声素材を選択してください");
        if (!audioFile) { return; }
        var imageFile = File.openDialog("背景画像を選択してください");
        if (!imageFile) { return; }
        var values = showTextDialog(audioFile.displayName.replace(/\.[^.]+$/, ""));
        if (!values) { return; }
        var outputFolder = Folder.selectDialog(".aep の保存先フォルダを選択してください");
        if (!outputFolder) { return; }

        var savedFile = null;
        var errorMessage = "";
        logLines.push("処理開始: " + formatDate(new Date()));
        logLines.push("テンプレート: " + templateFile.fsName);
        logLines.push("音声: " + audioFile.fsName);
        logLines.push("画像: " + imageFile.fsName);
        logLines.push("出力名: " + values.outputName);
        logLines.push("カテゴリ色: " + values.colorName + " " + values.colorHex);
        try {
            if (!templateFile.exists || !audioFile.exists || !imageFile.exists) {
                throw new Error("選択したファイルが存在しません。");
            }
            // Let AE offer to save the current project; cancellation must stop the run.
            if (app.project && !app.project.close(CloseOptions.PROMPT_TO_SAVE_CHANGES)) {
                return;
            }
            if (!app.open(templateFile)) { throw new Error("テンプレートを開けませんでした。"); }
            var comp = findCompByName(COMP_NAME);
            if (!comp) { throw new Error(COMP_NAME + " コンポジションが存在しません。"); }
            var spectrum = findLayerByName(comp, "Spectrum");
            if (!spectrum) { throw new Error("Spectrum レイヤーが存在しません。"); }
            if (findLayerByName(comp, IMAGE_LAYER_NAME) || findLayerByName(comp, AUDIO_LAYER_NAME)) {
                throw new Error("テンプレートから Background_Image / Audio_Source を取り除いてください。");
            }
            for (var t = 0; t < TEXT_NAMES.length; t++) {
                setTextLayerValue(comp, TEXT_NAMES[t], values[TEXT_NAMES[t]]);
            }
            setCategoryColor(comp, values.colorHex);
            var imageItem = importFootage(imageFile.fsName, "画像");
            if (!imageItem.hasVideo || !imageItem.mainSource.isStill || imageItem.width <= 0 || imageItem.height <= 0) {
                throw new Error("背景には静止画像を選択してください。");
            }
            var audioItem = importFootage(audioFile.fsName, "音声");
            if (!audioItem.hasAudio || !isFinite(audioItem.duration) || audioItem.duration <= 0) {
                throw new Error("音声を含む有効な素材を選択してください。");
            }
            var duration = audioItem.duration;
            comp.duration = duration;
            comp.workAreaStart = 0;
            comp.workAreaDuration = duration;
            setAllLayerOutPoints(comp, duration);
            addImageLayer(comp, imageItem, spectrum, duration);
            var audioLayer = addAudioLayer(comp, audioItem, spectrum, duration);
            audioLayer.audioEnabled = true;
            if (audioItem.hasVideo) { audioLayer.enabled = false; }
            var spectrumLocked = spectrum.locked;
            spectrum.locked = false;
            try { setAudioSpectrumLayer(spectrum, audioLayer); }
            finally { spectrum.locked = spectrumLocked; }
            var baseName = sanitizeFileBaseName(values.outputName);
            if (baseName !== values.outputName) { logLines.push("保存名を調整: " + baseName); }
            var outputFile = getUniqueAepFile(outputFolder, baseName);
            app.project.save(outputFile);
            savedFile = outputFile;
            logLines.push("[成功] 保存先: " + savedFile.fsName);
        } catch (err) {
            errorMessage = getErrorMessage(err);
            logLines.push("[失敗] " + errorMessage);
        }
        logLines.push("処理終了: " + formatDate(new Date()));
        var logWarning = writeLog(outputFolder);
        if (savedFile) {
            alert("生成が完了しました。\n" + savedFile.fsName + logWarning);
        } else {
            alert("生成に失敗しました。\n" + errorMessage + logWarning);
        }
        // Keep the generated project (or the failed working copy) open for inspection.
    }

    function showTextDialog(defaultName) {
        var dialog = new Window("dialog", "テキスト・保存名の入力");
        dialog.orientation = "column";
        dialog.alignChildren = ["fill", "top"];
        dialog.add("statictext", undefined, "テンプレートへ反映するテキストを入力してください。");
        var fields = {};
        var names = ["outputName", "Genre", "Original_Arrange", "Title"];
        var labels = ["保存ファイル名（拡張子不要）", "Genre", "原曲・アレンジ（Original_Arrange）", "タイトル（Title）"];
        for (var i = 0; i < names.length; i++) {
            dialog.add("statictext", undefined, labels[i]);
            fields[names[i]] = dialog.add("edittext", undefined, i === 0 ? defaultName : "", {multiline: i > 0, wantReturn: i > 0});
            fields[names[i]].preferredSize = [460, i === 0 ? 26 : 64];
        }
        var colorPanel = dialog.add("panel", undefined, "Category（カテゴリ名・色）");
        colorPanel.orientation = "row";
        colorPanel.alignChildren = ["left", "top"];
        var colorButtons = [];
        for (var c = 0; c < COLOR_OPTIONS.length; c++) {
            if (c % 5 === 0) {
                var column = colorPanel.add("group");
                column.orientation = "column";
                column.alignChildren = ["left", "top"];
            }
            var radio = column.add("radiobutton", undefined, COLOR_OPTIONS[c][0] + "  " + COLOR_OPTIONS[c][1]);
            colorButtons.push(radio);
            radio.onClick = function () {
                for (var r = 0; r < colorButtons.length; r++) {
                    colorButtons[r].value = colorButtons[r] === this;
                }
            };
        }
        colorButtons[0].value = true;
        var buttons = dialog.add("group");
        buttons.alignment = "right";
        var ok = buttons.add("button", undefined, "生成", {name: "ok"});
        buttons.add("button", undefined, "キャンセル", {name: "cancel"});
        var result = null;
        ok.onClick = function () {
            var input = {};
            for (var j = 0; j < names.length; j++) {
                input[names[j]] = fields[names[j]].text;
                if (trim(input[names[j]]) === "") {
                    alert(labels[j] + " を入力してください。");
                    fields[names[j]].active = true;
                    return;
                }
            }
            if (!sanitizeFileBaseName(input.outputName)) {
                alert("有効な保存ファイル名を入力してください。");
                return;
            }
            input.Original_Arrange = "Original：" + input.Original_Arrange;
            for (var c = 0; c < colorButtons.length; c++) {
                if (colorButtons[c].value) {
                    input.colorName = COLOR_OPTIONS[c][0];
                    input.colorHex = COLOR_OPTIONS[c][1];
                    break;
                }
            }
            input.Category_Genre = "Category：" + input.colorName + "　Genre：" + input.Genre;
            result = input;
            dialog.close(1);
        };
        return dialog.show() === 1 ? result : null;
    }

    function setCategoryColor(comp, hex) {
        var layer = findLayerByName(comp, "Category_color");
        if (!layer) { throw new Error("Category_color レイヤーが存在しません。"); }
        var contents = layer.property("ADBE Root Vectors Group");
        var fills = [];
        collectRectangleFills(contents, fills);
        if (fills.length === 0) {
            throw new Error("Category_color の長方形と同じグループ内に単色の塗りが必要です。");
        }
        for (var i = 0; i < fills.length; i++) {
            if (fills[i].expressionEnabled) {
                throw new Error("Category_color の塗りのカラーの式を無効にしてください。");
            }
        }
        var color = [parseInt(hex.substr(1, 2), 16) / 255,
            parseInt(hex.substr(3, 2), 16) / 255, parseInt(hex.substr(5, 2), 16) / 255, 1];
        var locked = layer.locked;
        layer.locked = false;
        try {
            for (var f = 0; f < fills.length; f++) {
                if (fills[f].numKeys > 0) {
                    for (var k = 1; k <= fills[f].numKeys; k++) {
                        fills[f].setValueAtKey(k, color);
                    }
                } else {
                    fills[f].setValue(color);
                }
            }
        } finally { layer.locked = locked; }
    }

    // Match names allow renamed groups and Japanese/English AE installations.
    function collectRectangleFills(contents, fills) {
        if (!contents) { return; }
        var hasRectangle = false;
        for (var i = 1; i <= contents.numProperties; i++) {
            var item = contents.property(i);
            if (item.matchName === "ADBE Vector Shape - Rect") { hasRectangle = true; }
            if (item.matchName === "ADBE Vector Group") {
                collectRectangleFills(item.property("ADBE Vectors Group"), fills);
            }
        }
        if (hasRectangle) {
            for (var j = 1; j <= contents.numProperties; j++) {
                var fill = contents.property(j);
                if (fill.matchName === "ADBE Vector Graphic - Fill") {
                    var color = fill.property("ADBE Vector Fill Color");
                    if (color) { fills.push(color); }
                }
            }
        }
    }

    function sanitizeFileBaseName(name) {
        var value = trim(name).replace(/\.aep$/i, "").replace(/[\\\/:*?"<>|\x00-\x1f]/g, "_").replace(/[.\s]+$/g, "");
        if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i.test(value)) { value = "_" + value; }
        return value;
    }

    function getUniqueAepFile(folder, name) {
        var candidate = File(folder.fsName + "/" + name + ".aep");
        var serial = 1;
        while (candidate.exists || Folder(candidate.fsName).exists) {
            candidate = File(folder.fsName + "/" + name + "_" + pad3(serial++) + ".aep");
        }
        return candidate;
    }

    function writeLog(folder) {
        var file = File(folder.fsName + "/process_log.txt");
        file.encoding = "UTF-8";
        try {
            if (!file.open("a")) { throw new Error(file.error); }
            try {
                if (!file.write(logLines.join("\n") + "\n\n")) { throw new Error(file.error); }
            } finally { file.close(); }
            return "\nログ: " + file.fsName;
        } catch (err) {
            return "\nログの保存に失敗しました: " + getErrorMessage(err);
        }
    }

    function importFootage(path, label) {
        var file = File(path);
        if (!file.exists) {
            throw new Error(label + "が存在しません: " + path);
        }

        var importOptions = new ImportOptions(file);
        if (!importOptions.canImportAs(ImportAsType.FOOTAGE)) {
            throw new Error(label + "をフッテージとして読み込めません: " + path);
        }
        importOptions.importAs = ImportAsType.FOOTAGE;
        importOptions.sequence = false;

        var item = app.project.importFile(importOptions);
        if (!item) {
            throw new Error(label + "の読み込みに失敗しました: " + path);
        }
        return item;
    }

    function addImageLayer(comp, imageItem, spectrumLayer, duration) {
        var imageLayer = comp.layers.add(imageItem);
        imageLayer.name = IMAGE_LAYER_NAME;
        imageLayer.startTime = 0;
        imageLayer.inPoint = 0;
        imageLayer.outPoint = duration;
        imageLayer.moveAfter(spectrumLayer);

        var scaleX = comp.width / imageLayer.source.width;
        var scaleY = comp.height / imageLayer.source.height;
        var scale = Math.max(scaleX, scaleY) * 100;
        getTransformProperty(imageLayer, "ADBE Position", "Position").setValue([comp.width / 2, comp.height / 2]);
        getTransformProperty(imageLayer, "ADBE Scale", "Scale").setValue([scale, scale]);

        return imageLayer;
    }

    function addAudioLayer(comp, audioItem, spectrumLayer, duration) {
        var audioLayer = comp.layers.add(audioItem);
        audioLayer.name = AUDIO_LAYER_NAME;
        audioLayer.startTime = 0;
        audioLayer.inPoint = 0;
        audioLayer.outPoint = duration;
        audioLayer.moveBefore(spectrumLayer);
        return audioLayer;
    }

    function setTextLayerValue(comp, layerName, textValue) {
        var layer = findLayerByName(comp, layerName);
        if (!layer) {
            throw new Error(layerName + " テキストレイヤーが存在しません。");
        }

        var textProp = getTextDocumentProperty(layer);
        if (!textProp) {
            throw new Error(layerName + " はテキストレイヤーではありません。");
        }

        if (textProp.expressionEnabled) {
            throw new Error(layerName + " の Source Text の式を無効にしてください。");
        }
        var locked = layer.locked;
        layer.locked = false;
        try {
            if (textProp.numKeys > 0) {
                for (var k = 1; k <= textProp.numKeys; k++) {
                    var keyedDoc = textProp.keyValue(k);
                    keyedDoc.text = textValue;
                    textProp.setValueAtKey(k, keyedDoc);
                }
            } else {
                var doc = textProp.value;
                doc.text = textValue;
                textProp.setValue(doc);
            }
        } finally {
            layer.locked = locked;
        }
    }

    function setAudioSpectrumLayer(spectrumLayer, audioLayer) {
        var effect = findAudioSpectrumEffect(spectrumLayer);
        if (!effect) {
            throw new Error("Audio Spectrum エフェクトが見つかりません。");
        }

        var audioLayerProp = findPropertyByNames(effect, ["Audio Layer", "オーディオレイヤー"], ["ADBE Audio Layer"]);
        if (!audioLayerProp) {
            for (var p = 1; p <= effect.numProperties; p++) {
                if (effect.property(p).propertyValueType === PropertyValueType.LAYER_INDEX) {
                    audioLayerProp = effect.property(p);
                    break;
                }
            }
        }
        if (!audioLayerProp) {
            throw new Error("Audio Spectrum の Audio Layer プロパティが見つかりません。");
        }

        try {
            audioLayerProp.setValue(audioLayer.index);
        } catch (err) {
            throw new Error("Audio_Source の参照設定に失敗しました: " + getErrorMessage(err));
        }
    }

    function findAudioSpectrumEffect(layer) {
        var effects = layer.property("ADBE Effect Parade");
        if (!effects) {
            return null;
        }

        for (var i = 1; i <= effects.numProperties; i++) {
            var effect = effects.property(i);
            if (effect.matchName === "ADBE Aud Spect" || effect.name === "Audio Spectrum" || effect.name === "オーディオスペクトラム") {
                return effect;
            }
        }
        return null;
    }

    function findPropertyByNames(group, names, matchNames) {
        if (!group || !group.numProperties) {
            return null;
        }

        for (var i = 1; i <= group.numProperties; i++) {
            var prop = group.property(i);
            if (contains(matchNames, prop.matchName) || contains(names, prop.name)) {
                return prop;
            }
            var child = findPropertyByNames(prop, names, matchNames);
            if (child) {
                return child;
            }
        }
        return null;
    }

    function findCompByName(name) {
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item instanceof CompItem && item.name === name) {
                return item;
            }
        }
        return null;
    }

    function findLayerByName(comp, name) {
        for (var i = 1; i <= comp.numLayers; i++) {
            if (comp.layer(i).name === name) {
                return comp.layer(i);
            }
        }
        return null;
    }

    function getTransformProperty(layer, matchName, fallbackName) {
        var transformGroup = layer.property("ADBE Transform Group");
        if (transformGroup) {
            var prop = transformGroup.property(matchName);
            if (prop) {
                return prop;
            }
        }
        return layer.property(fallbackName);
    }

    function getTextDocumentProperty(layer) {
        var textGroup = layer.property("ADBE Text Properties");
        if (textGroup) {
            var textProp = textGroup.property("ADBE Text Document");
            if (textProp) {
                return textProp;
            }
        }
        return layer.property("Source Text");
    }

    function setAllLayerOutPoints(comp, duration) {
        for (var i = 1; i <= comp.numLayers; i++) {
            var layer = comp.layer(i);
            var locked = layer.locked;
            layer.locked = false;
            try {
                if (layer.inPoint >= duration) {
                    throw new Error(layer.name + " の開始位置が音声尺以降です。テンプレートを調整してください。");
                }
                layer.outPoint = duration;
            } finally {
                layer.locked = locked;
            }
        }
    }

    function contains(values, target) {
        if (!target) {
            return false;
        }
        for (var i = 0; i < values.length; i++) {
            if (values[i] === target) {
                return true;
            }
        }
        return false;
    }

    function formatNotes(notes) {
        if (!notes || notes.length === 0) {
            return "";
        }
        return " 備考=" + notes.join(" / ");
    }

    function formatDate(date) {
        return date.getFullYear() + "-" +
            pad2(date.getMonth() + 1) + "-" +
            pad2(date.getDate()) + " " +
            pad2(date.getHours()) + ":" +
            pad2(date.getMinutes()) + ":" +
            pad2(date.getSeconds());
    }

    function pad2(value) {
        return value < 10 ? "0" + value : "" + value;
    }

    function pad3(value) {
        if (value < 10) {
            return "00" + value;
        }
        if (value < 100) {
            return "0" + value;
        }
        return "" + value;
    }

    function trim(value) {
        return String(value).replace(/^\s+|\s+$/g, "");
    }

    function getErrorMessage(err) {
        if (!err) {
            return "不明なエラー";
        }
        return err.message ? err.message : String(err);
    }

    main();
})();
