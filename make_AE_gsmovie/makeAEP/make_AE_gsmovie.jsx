/*
 * make_AE_gsmovie.jsx
 *
 * CSV rows are applied to a template After Effects project and saved as
 * individual .aep files. Rendering and render queue registration are not done.
 */
(function () {
    var SCRIPT_NAME = "make_AE_gsmovie";
    var COMP_NAME = "gs_template";
    var SPECTRUM_LAYER_NAME = "Spectrum";
    var IMAGE_LAYER_NAME = "Background_Image";
    var AUDIO_LAYER_NAME = "Audio_Source";
    var LOG_FILE_NAME = "process_log.txt";
    var REQUIRED_COLUMNS = [
        "outputName",
        "imagePath",
        "audioPath",
        "Category_Genre",
        "Original_Arrange",
        "Title"
    ];

    var logLines = [];
    var successCount = 0;
    var failureCount = 0;

    function main() {
        var templateFile = File.openDialog("テンプレート .aep を選択してください", "*.aep");
        if (!templateFile) {
            alert("テンプレート .aep が選択されていません。処理を中止します。");
            return;
        }

        var csvFile = File.openDialog("入力 CSV を選択してください", "*.csv");
        if (!csvFile) {
            alert("入力 CSV が選択されていません。処理を中止します。");
            return;
        }

        var outputFolder = Folder.selectDialog(".aep の保存先フォルダを選択してください");
        if (!outputFolder) {
            alert("保存先フォルダが選択されていません。処理を中止します。");
            return;
        }

        logLines.push("処理開始: " + formatDate(new Date()));
        logLines.push("テンプレート: " + templateFile.fsName);
        logLines.push("入力CSV: " + csvFile.fsName);
        logLines.push("保存先フォルダ: " + outputFolder.fsName);
        logLines.push("");

        var rows;
        try {
            rows = readCsvRows(csvFile);
            validateCsvHeader(rows.headerMap);
        } catch (err) {
            logLines.push("[失敗] 初期処理 理由=" + getErrorMessage(err));
            writeLog(outputFolder);
            alert("CSV の読み込みに失敗しました。\n" + getErrorMessage(err) + "\n\nログ: " + outputFolder.fsName + "/" + LOG_FILE_NAME);
            return;
        }

        app.beginUndoGroup(SCRIPT_NAME);
        try {
            for (var i = 0; i < rows.records.length; i++) {
                processRow(rows.records[i], rows.headerMap, rows.lineNumbers[i], templateFile, outputFolder);
            }
        } finally {
            try {
                if (app.project) {
                    app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
                }
            } catch (closeErr) {
            }
            app.endUndoGroup();
        }

        logLines.push("");
        logLines.push("処理終了: " + formatDate(new Date()));
        logLines.push("成功件数: " + successCount);
        logLines.push("失敗件数: " + failureCount);
        writeLog(outputFolder);

        alert("処理が完了しました。\n成功: " + successCount + " 件\n失敗: " + failureCount + " 件\nログ: " + outputFolder.fsName + "/" + LOG_FILE_NAME);
    }

    function processRow(record, headerMap, lineNumber, templateFile, outputFolder) {
        var row = rowToObject(record, headerMap);
        var originalOutputName = row.outputName || "";
        var notes = [];
        var saveFile = null;

        try {
            validateRequiredValues(row);

            var sanitizedName = sanitizeFileBaseName(row.outputName);
            if (!sanitizedName) {
                throw new Error("サニタイズ後の outputName が空です。");
            }
            if (sanitizedName !== row.outputName) {
                notes.push("ファイル名に使用できない文字を _ に置換しました");
            }

            saveFile = getUniqueAepFile(outputFolder, sanitizedName);
            if (saveFile.displayName !== sanitizedName + ".aep") {
                notes.push("同名ファイルが存在したため連番を付与しました");
            }

            assertAbsolutePath(row.imagePath, "imagePath");
            assertAbsolutePath(row.audioPath, "audioPath");
            assertFileExists(row.imagePath, "画像ファイル");
            assertFileExists(row.audioPath, "音声ファイル");

            openTemplateProject(templateFile);

            var comp = findCompByName(COMP_NAME);
            if (!comp) {
                throw new Error(COMP_NAME + " が存在しない、またはコンポジションではありません。");
            }

            var spectrumLayer = findLayerByName(comp, SPECTRUM_LAYER_NAME);
            if (!spectrumLayer) {
                throw new Error(SPECTRUM_LAYER_NAME + " レイヤーが存在しません。");
            }

            var imageItem = importFootage(row.imagePath, "画像ファイル");
            var audioItem = importFootage(row.audioPath, "音声ファイル");
            if (!audioItem.duration || audioItem.duration <= 0) {
                throw new Error("音声ファイルの duration を取得できません: " + row.audioPath);
            }

            var audioDuration = audioItem.duration;
            comp.duration = audioDuration;
            setAllLayerOutPoints(comp, audioDuration);

            var imageLayer = addImageLayer(comp, imageItem, spectrumLayer, audioDuration);
            var audioLayer = addAudioLayer(comp, audioItem, spectrumLayer, audioDuration);

            setTextLayerValue(comp, "Category_Genre", row.Category_Genre);
            setTextLayerValue(comp, "Original_Arrange", row.Original_Arrange);
            setTextLayerValue(comp, "Title", row.Title);
            setAudioSpectrumLayer(spectrumLayer, audioLayer);

            app.project.save(saveFile);

            successCount++;
            logLines.push("[成功] " + lineNumber + "行目 outputName=" + originalOutputName + " 保存先=" + saveFile.fsName + formatNotes(notes));
        } catch (err) {
            failureCount++;
            logLines.push("[失敗] " + lineNumber + "行目 outputName=" + originalOutputName + " 理由=" + getErrorMessage(err) + formatNotes(notes));
        } finally {
            try {
                if (app.project) {
                    app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
                }
            } catch (closeErr) {
            }
        }
    }

    function openTemplateProject(templateFile) {
        if (!templateFile.exists) {
            throw new Error("テンプレート .aep が存在しません: " + templateFile.fsName);
        }
        app.open(templateFile);
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

        var doc = textProp.value;
        doc.text = textValue;
        textProp.setValue(doc);
    }

    function setAudioSpectrumLayer(spectrumLayer, audioLayer) {
        var effect = findAudioSpectrumEffect(spectrumLayer);
        if (!effect) {
            throw new Error("Audio Spectrum エフェクトが見つかりません。");
        }

        var audioLayerProp = findPropertyByNames(effect, ["Audio Layer", "オーディオレイヤー"], ["ADBE Audio Layer"]);
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
            comp.layer(i).outPoint = duration;
        }
    }

    function readCsvRows(csvFile) {
        csvFile.encoding = "UTF-8";
        if (!csvFile.open("r")) {
            throw new Error("CSV を開けません: " + csvFile.fsName);
        }

        var text = csvFile.read();
        csvFile.close();

        if (text.length > 0 && text.charCodeAt(0) === 0xFEFF) {
            text = text.substring(1);
        }

        var parsed = parseCsv(text);
        if (parsed.rows.length < 1) {
            throw new Error("CSV が空です。");
        }

        var header = parsed.rows[0];
        var headerMap = {};
        for (var h = 0; h < header.length; h++) {
            headerMap[trim(header[h])] = h;
        }

        var records = [];
        var lineNumbers = [];
        for (var r = 1; r < parsed.rows.length; r++) {
            if (isEmptyRecord(parsed.rows[r])) {
                continue;
            }
            records.push(parsed.rows[r]);
            lineNumbers.push(parsed.lineNumbers[r]);
        }

        return {
            headerMap: headerMap,
            records: records,
            lineNumbers: lineNumbers
        };
    }

    function parseCsv(text) {
        var rows = [];
        var lineNumbers = [];
        var row = [];
        var field = "";
        var inQuotes = false;
        var lineNumber = 1;
        var rowStartLine = 1;

        for (var i = 0; i < text.length; i++) {
            var ch = text.charAt(i);

            if (inQuotes) {
                if (ch === "\"") {
                    if (i + 1 < text.length && text.charAt(i + 1) === "\"") {
                        field += "\"";
                        i++;
                    } else {
                        inQuotes = false;
                    }
                } else {
                    if (ch === "\n") {
                        lineNumber++;
                    }
                    field += ch;
                }
            } else {
                if (ch === "\"") {
                    inQuotes = true;
                } else if (ch === ",") {
                    row.push(field);
                    field = "";
                } else if (ch === "\r" || ch === "\n") {
                    row.push(field);
                    rows.push(row);
                    lineNumbers.push(rowStartLine);
                    row = [];
                    field = "";
                    if (ch === "\r" && i + 1 < text.length && text.charAt(i + 1) === "\n") {
                        i++;
                    }
                    lineNumber++;
                    rowStartLine = lineNumber;
                } else {
                    field += ch;
                }
            }
        }

        if (inQuotes) {
            throw new Error("CSV のダブルクォートが閉じられていません。");
        }
        if (field !== "" || row.length > 0) {
            row.push(field);
            rows.push(row);
            lineNumbers.push(rowStartLine);
        }

        return {
            rows: rows,
            lineNumbers: lineNumbers
        };
    }

    function validateCsvHeader(headerMap) {
        for (var i = 0; i < REQUIRED_COLUMNS.length; i++) {
            if (typeof headerMap[REQUIRED_COLUMNS[i]] === "undefined") {
                throw new Error("CSV ヘッダーに必須カラムがありません: " + REQUIRED_COLUMNS[i]);
            }
        }
    }

    function rowToObject(record, headerMap) {
        var row = {};
        for (var i = 0; i < REQUIRED_COLUMNS.length; i++) {
            var key = REQUIRED_COLUMNS[i];
            var index = headerMap[key];
            row[key] = typeof record[index] === "undefined" ? "" : record[index];
        }
        return row;
    }

    function validateRequiredValues(row) {
        for (var i = 0; i < REQUIRED_COLUMNS.length; i++) {
            var key = REQUIRED_COLUMNS[i];
            if (trim(row[key]) === "") {
                throw new Error("必須カラムが空です: " + key);
            }
        }
    }

    function assertFileExists(path, label) {
        if (!File(path).exists) {
            throw new Error(label + "が存在しません: " + path);
        }
    }

    function assertAbsolutePath(path, columnName) {
        var value = trim(path);
        var isWindowsAbsolute = /^[A-Za-z]:[\\\/]/.test(value) || /^\\\\/.test(value);
        var isUnixAbsolute = value.charAt(0) === "/";
        if (!isWindowsAbsolute && !isUnixAbsolute) {
            throw new Error(columnName + " は絶対パスで指定してください: " + path);
        }
    }

    function sanitizeFileBaseName(name) {
        var sanitized = trim(name).replace(/[\\\/:\*\?"<>\|]/g, "_");
        return trim(sanitized);
    }

    function getUniqueAepFile(outputFolder, baseName) {
        var file = File(outputFolder.fsName + "/" + baseName + ".aep");
        var serial = 1;

        while (file.exists) {
            file = File(outputFolder.fsName + "/" + baseName + "_" + pad3(serial) + ".aep");
            serial++;
        }
        return file;
    }

    function writeLog(outputFolder) {
        var logFile = File(outputFolder.fsName + "/" + LOG_FILE_NAME);
        logFile.encoding = "UTF-8";
        if (logFile.open("w")) {
            logFile.write(logLines.join("\n"));
            logFile.close();
        }
    }

    function isEmptyRecord(record) {
        for (var i = 0; i < record.length; i++) {
            if (trim(record[i]) !== "") {
                return false;
            }
        }
        return true;
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
