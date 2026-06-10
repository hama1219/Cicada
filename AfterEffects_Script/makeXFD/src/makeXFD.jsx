/*
  makeXFD.jsx
  Creates an After Effects crossfade demo composition from a UTF-8 CSV file.
*/

(function () {
  var COMP_WIDTH = 1280;
  var COMP_HEIGHT = 720;
  var COMP_PIXEL_ASPECT = 1.0;
  var COMP_FRAME_RATE = 30;
  var ENDING_DURATION = 7;

  var AUDIO_FADE_DURATION = 3;
  var TEXT_FADE_DURATION = 1;
  var TEXT_OVERLAP_DURATION = 0.5;
  var AUDIO_NORMAL_LEVEL = [0, 0];
  var AUDIO_SILENT_LEVEL = [-48, -48];

  var TRACK_TITLE_BOX_X = 40;
  var TRACK_TITLE_BOX_Y = 250;
  var TRACK_TITLE_BOX_WIDTH = 520;
  var TRACK_TITLE_BOX_HEIGHT = 160;

  var ORIGINAL_TITLE_BOX_X = 40;
  var ORIGINAL_TITLE_BOX_Y = 430;
  var ORIGINAL_TITLE_BOX_WIDTH = 520;
  var ORIGINAL_TITLE_BOX_HEIGHT = 120;

  var TRACK_TITLE_FONT_SIZE = 60;
  var ORIGINAL_TITLE_FONT_SIZE = 40;

  function main() {
    var csvFile = File.openDialog("Select makeXFD CSV", "*.csv");
    if (!csvFile) {
      throw new Error("CSV was not selected.");
    }

    app.beginUndoGroup("makeXFD");
    try {
      var csvText = readUtf8Text(csvFile);
      var csvData = parseCsv(csvText);
      var baseFolder = csvFile.parent;
      var prepared = prepareProjectData(csvData, baseFolder);
      var comp = buildComposition(prepared);
      comp.openInViewer();
      app.endUndoGroup();
      alert("makeXFD composition created: " + comp.name);
    } catch (error) {
      app.endUndoGroup();
      throw error;
    }
  }

  function readUtf8Text(file) {
    if (!file.exists) {
      throw new Error("CSV file does not exist: " + file.fsName);
    }

    File.encoding = "UTF-8";
    if (!file.open("r")) {
      throw new Error("Could not read CSV file: " + file.fsName);
    }

    var text = file.read();
    file.close();

    if (text.length > 0 && text.charCodeAt(0) === 0xFEFF) {
      text = text.substring(1);
    }

    return text;
  }

  function parseCsv(text) {
    var normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    var rawLines = normalized.split("\n");
    var rows = [];
    var i;

    for (i = 0; i < rawLines.length; i++) {
      if (trim(rawLines[i]) !== "") {
        rows.push(parseCsvLine(rawLines[i]));
      }
    }

    if (rows.length < 2) {
      throw new Error("CSV must contain one CD row and at least one track row.");
    }

    if (rows[0].length < 6) {
      throw new Error("CSV CD row has too few columns.");
    }

    for (i = 1; i < rows.length; i++) {
      if (rows[i].length < 5) {
        throw new Error("CSV track row " + (i + 1) + " has too few columns.");
      }
    }

    return rows;
  }

  function parseCsvLine(line) {
    var columns = line.split(",");
    var i;

    for (i = 0; i < columns.length; i++) {
      columns[i] = trim(columns[i]);
    }

    return columns;
  }

  function prepareProjectData(rows, baseFolder) {
    var cdRow = rows[0];
    var imageFile = resolveRequiredFile(baseFolder, cdRow[5], "image");
    var imageItem = importFootage(imageFile);
    var tracks = [];
    var previousEndTime = 0;
    var i;

    for (i = 1; i < rows.length; i++) {
      var row = rows[i];
      var trackNumber = i;
      var audioFileName = row[0];
      var trackTitle = row[1];
      var originalTitle = row[2];
      var csvStart = parseRequiredNumber(row[3], "start time", i + 1);
      var csvEnd = parseRequiredNumber(row[4], "end time", i + 1);
      var audioFile = resolveRequiredFile(baseFolder, audioFileName, "audio");
      var audioItem = importFootage(audioFile);
      var audioDuration = audioItem.duration;

      validateTrackRange(csvStart, csvEnd, audioDuration, i + 1);

      var audioRange = calculateAudioRange(csvStart, csvEnd, audioDuration, AUDIO_FADE_DURATION);
      var placement = i === 1
        ? { timelineStart: 0 }
        : calculateTimelinePlacement(previousEndTime, AUDIO_FADE_DURATION);
      var fadeDuration = calculateFadeDuration(csvStart, csvEnd, audioDuration, AUDIO_FADE_DURATION);
      var timelineEnd = placement.timelineStart + audioRange.actualDuration;

      tracks.push({
        trackNumber: trackNumber,
        audioItem: audioItem,
        audioFileName: audioFileName,
        trackTitle: trackTitle,
        originalTitle: originalTitle,
        csvStart: csvStart,
        csvEnd: csvEnd,
        audioDuration: audioDuration,
        audioRange: audioRange,
        placement: placement,
        fadeDuration: fadeDuration,
        timelineEnd: timelineEnd
      });

      previousEndTime = timelineEnd;
    }

    return {
      cdTitle: cdRow[0],
      date: cdRow[1],
      eventName: cdRow[2],
      price: cdRow[3],
      trackCount: cdRow[4],
      imageItem: imageItem,
      tracks: tracks,
      mainDuration: previousEndTime,
      compDuration: previousEndTime + ENDING_DURATION
    };
  }

  function buildComposition(data) {
    var compName = "XFD_" + data.cdTitle;
    var comp = app.project.items.addComp(
      compName,
      COMP_WIDTH,
      COMP_HEIGHT,
      COMP_PIXEL_ASPECT,
      data.compDuration,
      COMP_FRAME_RATE
    );

    addJacketLayer(comp, data.imageItem);

    var i;
    for (i = 0; i < data.tracks.length; i++) {
      addAudioLayer(comp, data.tracks[i]);
      addTrackTextLayers(comp, data.tracks[i]);
    }

    return comp;
  }

  function addJacketLayer(comp, imageItem) {
    var layer = comp.layers.add(imageItem);
    var sourceWidth = imageItem.width;
    var sourceHeight = imageItem.height;
    var imageSize = comp.height;
    var scalePercent;

    layer.name = "Image_CD_Jacket";
    layer.startTime = 0;
    layer.inPoint = 0;
    layer.outPoint = comp.duration;

    if (sourceWidth !== sourceHeight) {
      alert("Warning: jacket image is not square: " + imageItem.name);
    }

    scalePercent = imageSize / sourceWidth * 100;
    layer.property("Transform").property("Scale").setValue([scalePercent, scalePercent]);
    layer.property("Transform").property("Position").setValue([
      comp.width - imageSize / 2,
      comp.height / 2
    ]);
  }

  function addAudioLayer(comp, track) {
    var layer = comp.layers.add(track.audioItem);
    var timelineStart = track.placement.timelineStart;
    var timelineEnd = track.timelineEnd;
    var actualStart = track.audioRange.actualStart;
    var actualDuration = track.audioRange.actualDuration;

    layer.name = "Audio_" + padTrackNumber(track.trackNumber) + "_" + track.trackTitle;
    layer.startTime = timelineStart - actualStart;
    layer.inPoint = timelineStart;
    layer.outPoint = timelineStart + actualDuration;

    applyAudioFade(
      layer,
      timelineStart,
      timelineEnd,
      track.fadeDuration.fadeInDuration,
      track.fadeDuration.fadeOutDuration
    );
  }

  function applyAudioFade(layer, timelineStart, timelineEnd, fadeInDuration, fadeOutDuration) {
    var audioLevels = getAudioLevelsProperty(layer);
    var fadeInEnd = timelineStart + fadeInDuration;
    var fadeOutStart = timelineEnd - fadeOutDuration;

    audioLevels.setValueAtTime(timelineStart, AUDIO_SILENT_LEVEL);
    audioLevels.setValueAtTime(fadeInEnd, AUDIO_NORMAL_LEVEL);
    audioLevels.setValueAtTime(fadeOutStart, AUDIO_NORMAL_LEVEL);
    audioLevels.setValueAtTime(timelineEnd, AUDIO_SILENT_LEVEL);
  }

  function addTrackTextLayers(comp, track) {
    var textStartTime = calculateTextStartTime(track);
    var textEndTime = track.timelineEnd;
    var titleLayer = createBoxTextLayer(
      comp,
      "Text_" + padTrackNumber(track.trackNumber) + "_TrackTitle",
      track.trackTitle,
      TRACK_TITLE_BOX_X,
      TRACK_TITLE_BOX_Y,
      TRACK_TITLE_BOX_WIDTH,
      TRACK_TITLE_BOX_HEIGHT,
      TRACK_TITLE_FONT_SIZE
    );
    var originalLayer = createBoxTextLayer(
      comp,
      "Text_" + padTrackNumber(track.trackNumber) + "_OriginalTitle",
      track.originalTitle,
      ORIGINAL_TITLE_BOX_X,
      ORIGINAL_TITLE_BOX_Y,
      ORIGINAL_TITLE_BOX_WIDTH,
      ORIGINAL_TITLE_BOX_HEIGHT,
      ORIGINAL_TITLE_FONT_SIZE
    );

    configureTextTiming(titleLayer, textStartTime, textEndTime);
    configureTextTiming(originalLayer, textStartTime, textEndTime);
  }

  function calculateTextStartTime(track) {
    if (track.trackNumber === 1) {
      return track.placement.timelineStart;
    }

    return Math.min(
      track.placement.timelineStart + AUDIO_FADE_DURATION - TEXT_OVERLAP_DURATION,
      track.timelineEnd
    );
  }

  function createBoxTextLayer(comp, layerName, text, x, y, width, height, fontSize) {
    var layer = comp.layers.addBoxText([width, height]);
    var textDocument = layer.property("Source Text").value;

    textDocument.text = text;
    textDocument.fontSize = fontSize;
    textDocument.justification = ParagraphJustification.LEFT_JUSTIFY;
    textDocument.applyFill = true;
    textDocument.fillColor = [1, 1, 1];

    layer.name = layerName;
    layer.property("Source Text").setValue(textDocument);
    layer.property("Transform").property("Position").setValue([
      x + width / 2,
      y + height / 2
    ]);

    return layer;
  }

  function configureTextTiming(layer, textStartTime, textEndTime) {
    var opacity = layer.property("Transform").property("Opacity");
    var fadeInEnd = Math.min(textStartTime + TEXT_FADE_DURATION, textEndTime);
    var fadeOutStart = Math.max(textEndTime - TEXT_FADE_DURATION, textStartTime);

    layer.inPoint = textStartTime;
    layer.outPoint = textEndTime;
    opacity.setValueAtTime(textStartTime, 0);
    opacity.setValueAtTime(fadeInEnd, 100);
    opacity.setValueAtTime(fadeOutStart, 100);
    opacity.setValueAtTime(textEndTime, 0);
  }

  function calculateAudioRange(csvStart, csvEnd, audioDuration, fadeDuration) {
    var actualStart = Math.max(0, csvStart - fadeDuration);
    var actualEnd = Math.min(audioDuration, csvEnd + fadeDuration);
    var actualDuration = actualEnd - actualStart;

    return {
      actualStart: actualStart,
      actualEnd: actualEnd,
      actualDuration: actualDuration
    };
  }

  function calculateTimelinePlacement(previousEndTime, fadeDuration) {
    return {
      timelineStart: previousEndTime - fadeDuration
    };
  }

  function calculateFadeDuration(csvStart, csvEnd, audioDuration, fadeDuration) {
    return {
      fadeInDuration: Math.min(fadeDuration, csvStart),
      fadeOutDuration: Math.min(fadeDuration, audioDuration - csvEnd)
    };
  }

  function resolveRequiredFile(baseFolder, fileName, label) {
    if (!fileName) {
      throw new Error("Missing " + label + " file name.");
    }

    var file = File(baseFolder.fsName + "/" + fileName);
    if (!file.exists) {
      throw new Error("Missing " + label + " file: " + fileName);
    }

    return file;
  }

  function importFootage(file) {
    var options = new ImportOptions(file);
    if (!options.canImportAs(ImportAsType.FOOTAGE)) {
      throw new Error("Could not import file as footage: " + file.fsName);
    }

    options.importAs = ImportAsType.FOOTAGE;
    return app.project.importFile(options);
  }

  function validateTrackRange(csvStart, csvEnd, audioDuration, csvRowNumber) {
    if (csvStart < 0) {
      throw new Error("CSV row " + csvRowNumber + ": start time must be 0 or greater.");
    }

    if (csvEnd <= csvStart) {
      throw new Error("CSV row " + csvRowNumber + ": end time must be greater than start time.");
    }

    if (csvEnd > audioDuration) {
      throw new Error(
        "CSV row " + csvRowNumber + ": end time exceeds audio duration (" + audioDuration + " sec)."
      );
    }
  }

  function parseRequiredNumber(value, label, csvRowNumber) {
    var parsed = parseFloat(value);
    if (isNaN(parsed)) {
      throw new Error("CSV row " + csvRowNumber + ": " + label + " is not a number.");
    }

    return parsed;
  }

  function getAudioLevelsProperty(layer) {
    var audioGroup = layer.property("ADBE Audio Group");
    var audioLevels;

    if (audioGroup) {
      audioLevels = audioGroup.property("ADBE Audio Levels");
      if (audioLevels) {
        return audioLevels;
      }
    }

    audioGroup = layer.property("Audio");
    if (audioGroup) {
      audioLevels = audioGroup.property("Audio Levels");
      if (audioLevels) {
        return audioLevels;
      }
    }

    throw new Error("Audio Levels property was not found: " + layer.name);
  }

  function padTrackNumber(trackNumber) {
    if (trackNumber < 10) {
      return "0" + trackNumber;
    }

    return String(trackNumber);
  }

  function trim(value) {
    return String(value).replace(/^\s+|\s+$/g, "");
  }

  try {
    main();
  } catch (error) {
    alert("makeXFD error:\n" + error.message);
  }
}());
