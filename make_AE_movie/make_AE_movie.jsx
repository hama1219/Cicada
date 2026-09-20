/* make_AE_movie.jsx — 画像と音声からSpectrum付きのAfter Effectsプロジェクトを作成 */
(function () {
    var SCRIPT_NAME = "make_AE_movie";
    var COMP_NAME = "movie";
    var WIDTH = 1920;
    var HEIGHT = 1080;
    var FRAME_RATE = 30;
    var logLines = [];

    function main() {
        var imageFile = File.openDialog("画像ファイルを選択してください", undefined, false);
        if (!imageFile) { return; }
        var audioFile = File.openDialog("音声ファイルを選択してください", undefined, false);
        if (!audioFile) { return; }
        var outputFolder = Folder.selectDialog(".aep の保存先フォルダを選択してください");
        if (!outputFolder) { return; }

        var savedFile = null;
        var result = "失敗";
        var reason = "";
        logLines.push("処理開始: " + formatDate(new Date()));
        logLines.push("画像: " + imageFile.fsName);
        logLines.push("音声: " + audioFile.fsName);
        logLines.push("保存先フォルダ: " + outputFolder.fsName);
        logLines.push("コンポジション: " + COMP_NAME + " / " + WIDTH + " x " + HEIGHT + " / PAR 1.0 / " + FRAME_RATE + " fps");

        try {
            assertExists(imageFile, "画像ファイル");
            assertExists(audioFile, "音声ファイル");
            if (!outputFolder.exists) { throw new Error("保存先フォルダが存在しません。"); }
            var originalName = File.decode(audioFile.name).replace(/\.[^.]*$/, "");
            var baseName = sanitizeFileBaseName(originalName);
            if (!baseName) { throw new Error("補正後の保存ファイル名が空です。"); }
            if (baseName !== originalName) {
                logLines.push("備考: 保存名を補正しました: " + originalName + " → " + baseName);
            }

            // 新規作成前にAE自身の保存確認を行い、キャンセルを尊重する。
            if (app.project && !app.project.close(CloseOptions.PROMPT_TO_SAVE_CHANGES)) {
                result = "中止";
                reason = "既存プロジェクトの保存確認がキャンセルされました。";
            } else {
                if (!app.newProject()) { throw new Error("新規プロジェクトを作成できませんでした。"); }
                createMovie(imageFile, audioFile);
                // 生成中に同名ファイルが作成された場合も、保存直前に回避する。
                var saveFile = getUniqueAepFile(outputFolder, baseName);
                logLines.push("保存予定: " + saveFile.fsName);
                app.project.save(saveFile);
                if (!saveFile.exists) { throw new Error("保存した .aep を確認できません: " + saveFile.fsName); }
                savedFile = saveFile;
                result = "成功";
            }
        } catch (err) {
            reason = errorMessage(err);
        }

        logLines.push("[" + result + "]" + (savedFile ? " 保存先=" + savedFile.fsName : ""));
        if (reason) { logLines.push("理由: " + reason); }
        logLines.push("処理終了: " + formatDate(new Date()));

        var message = "処理結果: " + result;
        if (savedFile) { message += "\n保存先: " + savedFile.fsName; }
        if (reason) { message += "\n" + reason; }
        try {
            var logFile = writeLog(outputFolder);
            message += "\nログ: " + logFile.fsName;
        } catch (logErr) {
            message += "\nログ出力に失敗しました: " + errorMessage(logErr);
        }
        alert(message, SCRIPT_NAME);
    }

    function createMovie(imageFile, audioFile) {
        app.beginUndoGroup(SCRIPT_NAME);
        try {
            var imageItem = importFootage(imageFile, "画像");
            if (!(imageItem instanceof FootageItem) || !imageItem.hasVideo ||
                    !imageItem.mainSource.isStill || imageItem.width <= 0 || imageItem.height <= 0) {
                throw new Error("静止画像として使用できない素材です: " + imageFile.fsName);
            }
            var audioItem = importFootage(audioFile, "音声");
            if (!(audioItem instanceof FootageItem) || !audioItem.hasAudio || audioItem.hasVideo) {
                throw new Error("音声専用ファイルを選択してください: " + audioFile.fsName);
            }
            var duration = audioItem.duration;
            logLines.push("音声尺: " + duration + " 秒");
            if (!isFinite(duration) || duration <= 0) {
                throw new Error("音声尺が無効です。");
            }

            // 音声末尾を含む整数秒へ切り上げる。音声自体の尺は変更しない。
            var requestedDuration = Math.ceil(duration);
            // AEの許容範囲外の尺はaddCompの例外として扱い、短縮しない。
            var comp = app.project.items.addComp(COMP_NAME, WIDTH, HEIGHT, 1, requestedDuration, FRAME_RATE);
            var compDuration = comp ? comp.duration : 0;
            logLines.push("コンポジション尺: " + compDuration + " 秒 / 秒単位切り上げ後の要求尺: " + requestedDuration + " 秒");
            if (!comp || !isFinite(compDuration) || compDuration <= 0 ||
                    Math.abs(compDuration - requestedDuration) > 0.000001 ||
                    compDuration + 0.000001 < duration) {
                throw new Error("音声末尾を含むコンポジションを作成できませんでした。音声尺=" +
                    duration + " / 要求尺=" + requestedDuration + " / 実際の尺=" + compDuration);
            }
            comp.displayStartTime = 0;
            var imageLayer = comp.layers.add(imageItem);
            imageLayer.name = "Background_Image";
            var audioLayer = comp.layers.add(audioItem);
            audioLayer.name = "Audio_Source";
            audioLayer.audioEnabled = true;
            var spectrumLayer = comp.layers.addSolid([0, 0, 0], "Spectrum", WIDTH, HEIGHT, 1, compDuration);
            audioLayer.moveToBeginning();
            spectrumLayer.moveAfter(audioLayer);
            imageLayer.moveAfter(spectrumLayer);

            var transform = imageLayer.property("ADBE Transform Group");
            var scale = Math.max(
                comp.width * comp.pixelAspect / (imageItem.width * imageItem.pixelAspect),
                comp.height / imageItem.height
            ) * 100;
            transform.property("ADBE Anchor Point").setValue([imageItem.width / 2, imageItem.height / 2]);
            transform.property("ADBE Position").setValue([comp.width / 2, comp.height / 2]);
            transform.property("ADBE Scale").setValue([scale, scale]);

            configureSpectrum(spectrumLayer, audioLayer);
            var spectrumTransform = spectrumLayer.property("ADBE Transform Group");
            spectrumTransform.property("ADBE Position").setValue([comp.width / 2, 540.0]);
            spectrumTransform.property("ADBE Opacity").setValue(50);
            logLines.push("Spectrumトランスフォーム: 位置=[" + (comp.width / 2) + ", 540.0] / 不透明度=50%");
            for (var i = 1; i <= comp.numLayers; i++) {
                var layer = comp.layer(i);
                layer.startTime = 0;
                layer.inPoint = 0;
                layer.outPoint = layer === audioLayer ? duration : compDuration;
            }
            comp.workAreaStart = 0;
            comp.workAreaDuration = compDuration;
            comp.openInViewer();
        } finally {
            app.endUndoGroup();
        }
    }

    function configureSpectrum(spectrumLayer, audioLayer) {
        var effectMatchName = "ADBE AudSpect";
        var effects = spectrumLayer.property("ADBE Effect Parade");
        if (!effects || !effects.canAddProperty(effectMatchName)) {
            throw new Error("Audio Spectrum エフェクトを追加できません。識別名: " + effectMatchName);
        }
        var effect = effects.addProperty(effectMatchName);
        var audioProperty = null;
        var compositeProperty = null;
        for (var i = 1; i <= effect.numProperties; i++) {
            var prop = effect.property(i);
            // Audio Spectrum内の音声参照はLAYER_INDEX型で識別する。
            if (prop.propertyValueType === PropertyValueType.LAYER_INDEX) {
                if (audioProperty) { throw new Error("Audio Spectrum の音声参照を一意に特定できません。"); }
                audioProperty = prop;
            }
            var name = prop.name.replace(/\s/g, "").toLowerCase();
            if (name === "compositeonoriginal" || name === "元を合成" || name === "元の画像と合成" || name === "元画像と合成") {
                compositeProperty = prop;
            }
        }
        if (!audioProperty || !compositeProperty) {
            throw new Error("Audio Spectrum の Audio Layer または元の画像と合成プロパティが見つかりません。");
        }
        audioProperty.setValue(audioLayer.index);
        compositeProperty.setValue(0);
        setSpectrumValue(effect, "Start Frequency", "開始周波数", 300);
        setSpectrumValue(effect, "End Frequency", "終了周波数", 1500);
        setSpectrumValue(effect, "Maximum Height", "最大高さ", 6000);
        setSpectrumValue(effect, "Thickness", "太さ", 8);
        setSpectrumValue(effect, "Frequency Bands", "周波数バンド", 128);
        setSpectrumValue(effect, "Inside Color", "内側のカラー", [1, 1, 1, 1]);
        setSpectrumValue(effect, "Outside Color", "外側のカラー", [1, 1, 1, 1]);
        // 太さ8pxの基準線を下端に収め、左右の余白を等しくする。
        setSpectrumValue(effect, "Start Point", "開始ポイント", [4, HEIGHT - 4]);
        setSpectrumValue(effect, "End Point", "終了ポイント", [WIDTH - 4, HEIGHT - 4]);
        if (audioProperty.value !== audioLayer.index || Number(compositeProperty.value) !== 0) {
            throw new Error("Audio Spectrum の音声参照または透明背景の設定に失敗しました。");
        }
        logLines.push("Spectrum参照音声: " + audioLayer.name + " / レイヤー番号 " + audioLayer.index);
        logLines.push("Spectrum設定: 開始周波数=300 Hz / 終了周波数=1500 Hz / 最大高さ=6000 / 太さ=8.00 / 周波数バンド=128");
        logLines.push("Spectrumカラー: 内側=#FFFFFF / 外側=#FFFFFF");
        logLines.push("Spectrum配置: 下詰め・左右中央 / 開始=[4, " + (HEIGHT - 4) + "] / 終了=[" + (WIDTH - 4) + ", " + (HEIGHT - 4) + "]");
    }

    function setSpectrumValue(effect, englishName, japaneseName, value) {
        var normalizedEnglish = englishName.replace(/\s/g, "").toLowerCase();
        for (var i = 1; i <= effect.numProperties; i++) {
            var prop = effect.property(i);
            var name = prop.name.replace(/\s/g, "").toLowerCase();
            if (name === normalizedEnglish || name === japaneseName) {
                prop.setValue(value);
                var actual = prop.value;
                var matches = true;
                if (value instanceof Array) {
                    matches = actual && actual.length === value.length;
                    for (var j = 0; matches && j < value.length; j++) {
                        matches = Math.abs(Number(actual[j]) - value[j]) < 0.000001;
                    }
                } else {
                    matches = Number(actual) === value;
                }
                if (!matches) {
                    throw new Error("Audio Spectrum の" + japaneseName + "を設定できませんでした。");
                }
                return;
            }
        }
        throw new Error("Audio Spectrum の" + japaneseName + "プロパティが見つかりません。");
    }

    function importFootage(file, label) {
        assertExists(file, label);
        var options = new ImportOptions(file);
        if (!options.canImportAs(ImportAsType.FOOTAGE)) {
            throw new Error(label + "をフッテージとして読み込めません: " + file.fsName);
        }
        options.importAs = ImportAsType.FOOTAGE;
        options.sequence = false;
        var item = app.project.importFile(options);
        if (!item) { throw new Error(label + "の読み込みに失敗しました: " + file.fsName); }
        return item;
    }

    function assertExists(file, label) {
        if (!file.exists) { throw new Error(label + "が存在しません: " + file.fsName); }
    }

    function sanitizeFileBaseName(name) {
        var value = String(name).replace(/[\\\/:*?"<>|\x00-\x1f\x7f]/g, "_");
        value = value.replace(/^\s+|[\s.]+$/g, "");
        if (/^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i.test(value)) {
            value = "_" + value;
        }
        return value;
    }

    function childFile(folder, name) {
        // URIとして連結し、素材名に含まれる%や#をパスとして保持する。
        return File(folder.absoluteURI + "/" + File.encode(name));
    }

    function getUniqueAepFile(folder, baseName) {
        var name = baseName + ".aep";
        var file = childFile(folder, name);
        var serial = 1;
        while (file.exists || Folder(file.absoluteURI).exists) {
            name = baseName + "_" + pad(serial, 3) + ".aep";
            file = childFile(folder, name);
            serial++;
        }
        if (serial > 1) { logLines.push("備考: 同名回避のため連番を付与しました: " + name); }
        return file;
    }

    function writeLog(folder) {
        var file = childFile(folder, "process_log.txt");
        file.encoding = "UTF-8";
        file.lineFeed = "Windows";
        if (!file.open("a")) { throw new Error(file.error || "ログファイルを開けません。"); }
        var writeError = "";
        try {
            if (!file.write("\n--- " + SCRIPT_NAME + " ---\n" + logLines.join("\n") + "\n")) {
                writeError = file.error || "ログを書き込めません。";
            }
        } finally {
            if (!file.close() && !writeError) { writeError = file.error || "ログを閉じられません。"; }
        }
        if (writeError) { throw new Error(writeError); }
        return file;
    }

    function pad(value, width) {
        var text = String(value);
        while (text.length < width) { text = "0" + text; }
        return text;
    }

    function formatDate(date) {
        return date.getFullYear() + "-" + pad(date.getMonth() + 1, 2) + "-" + pad(date.getDate(), 2) +
            " " + pad(date.getHours(), 2) + ":" + pad(date.getMinutes(), 2) + ":" + pad(date.getSeconds(), 2);
    }

    function errorMessage(err) {
        return err && err.message ? err.message : String(err);
    }

    main();
})();
