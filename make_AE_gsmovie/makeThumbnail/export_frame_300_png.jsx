/*
 * export_frame_300_png.jsx
 *
 * Exports the 300th frame of an After Effects composition as a PNG.
 * The active comp is used first. If no comp is active, the first comp in
 * the project is used. If no project is open, the script asks for an .aep.
 */
(function () {
    var SCRIPT_NAME = "export_frame_300_png";
    var FRAME_NUMBER = 300;
    var FRAME_NUMBER_IS_ONE_BASED = true;

    function main() {
        app.beginUndoGroup(SCRIPT_NAME);
        try {
            ensureProjectOpen();

            var comp = getTargetComp();
            if (!comp) {
                alert("No composition was found in the project.");
                return;
            }

            var outputFolder = Folder.selectDialog("Select a folder for the PNG output");
            if (!outputFolder) {
                alert("Output was canceled.");
                return;
            }

            var frameIndex = FRAME_NUMBER_IS_ONE_BASED ? FRAME_NUMBER - 1 : FRAME_NUMBER;
            if (frameIndex < 0) {
                throw new Error("FRAME_NUMBER must be 1 or greater when FRAME_NUMBER_IS_ONE_BASED is true.");
            }

            var frameDuration = comp.frameDuration;
            if (!frameDuration || frameDuration <= 0) {
                frameDuration = 1 / comp.frameRate;
            }

            var frameTime = frameIndex * frameDuration;
            if (frameTime > comp.duration) {
                throw new Error(
                    "Frame " + FRAME_NUMBER + " is outside the target comp duration. " +
                    "Comp duration: " + comp.duration + " sec."
                );
            }

            var outputFile = getUniquePngFile(outputFolder, comp.name + "_frame_" + padNumber(FRAME_NUMBER, 4));
            comp.saveFrameToPng(frameTime, outputFile);

            alert("PNG exported:\n" + outputFile.fsName);
        } catch (err) {
            alert("Failed to export PNG:\n" + getErrorMessage(err));
        } finally {
            app.endUndoGroup();
        }
    }

    function ensureProjectOpen() {
        if (app.project && app.project.file) {
            return;
        }

        var projectFile = File.openDialog("Select an After Effects project", "*.aep");
        if (!projectFile) {
            throw new Error("No project was selected.");
        }

        app.open(projectFile);
    }

    function getTargetComp() {
        if (app.project.activeItem && app.project.activeItem instanceof CompItem) {
            return app.project.activeItem;
        }

        for (var i = 1; i <= app.project.numItems; i++) {
            if (app.project.item(i) instanceof CompItem) {
                return app.project.item(i);
            }
        }

        return null;
    }

    function getUniquePngFile(folder, baseName) {
        var safeBaseName = sanitizeFileBaseName(baseName);
        var file = File(folder.fsName + "/" + safeBaseName + ".png");
        var index = 1;

        while (file.exists) {
            file = File(folder.fsName + "/" + safeBaseName + "_" + padNumber(index, 2) + ".png");
            index++;
        }

        return file;
    }

    function sanitizeFileBaseName(value) {
        var name = String(value || "frame");
        name = name.replace(/[\\\/:\*\?"<>\|]/g, "_");
        name = name.replace(/^\s+|\s+$/g, "");
        return name || "frame";
    }

    function padNumber(value, length) {
        var text = String(value);
        while (text.length < length) {
            text = "0" + text;
        }
        return text;
    }

    function getErrorMessage(err) {
        if (!err) {
            return "Unknown error";
        }
        return err.message || String(err);
    }

    main();
})();
