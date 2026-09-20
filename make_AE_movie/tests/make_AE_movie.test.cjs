// Run: node make_AE_movie/tests/make_AE_movie.test.cjs
// Host mocks check control flow; actual AE rendering/import compatibility needs AE.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '../make_AE_movie.jsx'), 'utf8');

function run(options = {}) {
    const state = { alerts: [], files: new Set(options.existing || []), log: '', closed: 0, created: 0, saved: null, undo: 0 };
    function File(uri) {
        if (!(this instanceof File)) return new File(uri);
        this.absoluteURI = uri;
        this.fsName = decodeURI(uri);
        this.name = uri.split('/').pop();
    }
    Object.defineProperty(File.prototype, 'exists', { get() { return state.files.has(this.absoluteURI); } });
    File.encode = encodeURIComponent;
    File.decode = decodeURIComponent;
    File.prototype.open = function () { return !options.logFailure; };
    File.prototype.write = function (text) { state.log += text; return true; };
    File.prototype.close = () => true;
    const image = File('/input/image.png');
    const audio = File('/input/' + encodeURIComponent(options.name || '音声 100%.wav'));
    state.files.add(image.absoluteURI);
    state.files.add(audio.absoluteURI);
    let dialog = 0;
    File.openDialog = () => (++dialog === options.cancelDialog ? null : dialog === 1 ? image : audio);
    function Folder(uri) { return { absoluteURI: uri, fsName: uri, exists: uri === '/output' }; }
    Folder.selectDialog = () => options.cancelFolder ? null : Folder('/output');
    function FootageItem(isImage) {
        Object.assign(this, { hasVideo: isImage, hasAudio: !isImage, mainSource: { isStill: isImage }, width: options.width || 800, height: options.height || 1200, pixelAspect: options.par || 1, duration: options.duration === undefined ? 12.5 : options.duration });
        if (isImage && options.invalidImage) this.mainSource.isStill = false;
    }
    const property = (name, type, value) => ({ name, propertyValueType: type, value, setValue(v) { this.value = v; } });
    const audioProp = property('Audio Layer', 1, 0);
    const compositeProp = property(options.english ? 'Composite On Original' : '元を合成', 2, 1);
    state.audioProp = audioProp;
    state.compositeProp = compositeProp;
    state.spectrumSettings = [
        property(options.english ? 'Start Frequency' : '開始周波数', 2, 20),
        property(options.english ? 'End Frequency' : '終了周波数', 2, 20000),
        property(options.english ? 'Maximum Height' : '最大高さ', 2, 100),
        property(options.english ? 'Frequency Bands' : '周波数バンド', 2, 64),
        property(options.english ? 'Thickness' : '太さ', 2, 3),
        property(options.english ? 'Start Point' : '開始ポイント', 3, [0, 540]),
        property(options.english ? 'End Point' : '終了ポイント', 3, [1920, 540]),
        property(options.english ? 'Inside Color' : '内側のカラー', 4, [1, 0, 0, 1]),
        property(options.english ? 'Outside Color' : '外側のカラー', 4, [0, 0, 1, 1])
    ];
    function makeComp(name, width, height, pixelAspect, duration, frameRate) {
        if (duration > 10800) throw Error('duration out of range');
        // AEがフレーム境界へ丸める挙動を再現する。
        duration = Math.round(duration * frameRate) / frameRate;
        if (options.truncateComp) duration -= 1 / frameRate;
        const layers = [];
        const comp = { name, width, height, pixelAspect, duration, frameRate, get numLayers() { return layers.length; }, layer: i => layers[i - 1], openInViewer() {} };
        function add(item) {
            const transforms = {};
            const layer = { source: item, get index() { return layers.indexOf(this) + 1; },
                moveToBeginning() { layers.splice(layers.indexOf(this), 1); layers.unshift(this); },
                moveAfter(other) { layers.splice(layers.indexOf(this), 1); layers.splice(layers.indexOf(other) + 1, 0, this); },
                property(key) {
                    if (key === 'ADBE Transform Group') return { property(p) { return transforms[p] || (transforms[p] = property(p, 2, null)); } };
                    return {
                        canAddProperty: name => name === 'ADBE AudSpect' && !options.effectFailure,
                        addProperty(name) {
                            assert.equal(name, 'ADBE AudSpect');
                            if (options.effectFailure) throw Error('Effect unavailable');
                            const props = [audioProp, compositeProp, ...state.spectrumSettings];
                            return { numProperties: props.length, property: i => props[i - 1] };
                        }
                    };
                }, transforms
            };
            layers.unshift(layer);
            return layer;
        }
        comp.layers = { add, addSolid: (color, name) => { const layer = add({}); layer.name = name; return layer; } };
        state.comp = comp;
        return comp;
    }
    const app = {
        project: { close(mode) { assert.equal(mode, 1); state.closed++; return !options.cancelSave; } },
        newProject() {
            state.created++;
            return this.project = {
                importFile: input => new FootageItem(input.file === image), items: { addComp: makeComp },
                save(file) { if (options.saveFailure) throw Error('保存失敗'); state.saved = file.absoluteURI; state.files.add(file.absoluteURI); }
            };
        },
        beginUndoGroup() { state.undo++; }, endUndoGroup() { state.undo--; }
    };
    function ImportOptions(file) { this.file = file; this.canImportAs = () => true; }
    vm.runInNewContext(source, { File, Folder, FootageItem, ImportOptions, ImportAsType: { FOOTAGE: 1 }, PropertyValueType: { LAYER_INDEX: 1 }, CloseOptions: { PROMPT_TO_SAVE_CHANGES: 1 }, app, alert: text => state.alerts.push(text) });
    assert.equal(state.undo, 0);
    return state;
}

for (const settings of [{}, { english: true, width: 2400, height: 800 }, { par: 2 }]) {
    const s = run(settings);
    assert.ok(s.saved);
    assert.equal(s.comp.width, 1920);
    assert.equal(s.comp.height, 1080);
    assert.equal(s.comp.frameRate, 30);
    assert.equal(s.comp.workAreaDuration, 13);
    assert.equal(s.audioProp.value, s.comp.layer(1).index);
    assert.equal(s.compositeProp.value, 0);
    assert.deepEqual(JSON.parse(JSON.stringify(s.spectrumSettings.map(p => p.value))),
        [300, 1500, 6000, 128, 8, [4, 1076], [1916, 1076], [1, 1, 1, 1], [1, 1, 1, 1]]);
    assert.deepEqual([1, 2, 3].map(i => s.comp.layer(i).name), ['Audio_Source', 'Spectrum', 'Background_Image']);
    const spectrumTransform = s.comp.layer(2).transforms;
    assert.deepEqual(Array.from(spectrumTransform['ADBE Position'].value), [960, 540]);
    assert.equal(spectrumTransform['ADBE Opacity'].value, 50);
    assert.equal(s.comp.layer(1).outPoint, 12.5);
    for (let i = 2; i <= 3; i++) assert.equal(s.comp.layer(i).outPoint, 13);
    const image = s.comp.layer(3), scale = image.transforms['ADBE Scale'].value[0] / 100;
    assert.ok(image.source.width * image.source.pixelAspect * scale >= 1920);
    assert.ok(image.source.height * scale >= 1080);
}
for (const settings of [{ cancelDialog: 1 }, { cancelDialog: 2 }, { cancelFolder: true }]) {
    const s = run(settings);
    assert.equal(s.closed, 0);
    assert.equal(s.created, 0);
    assert.equal(s.log, '');
}
const cancelled = run({ cancelSave: true });
assert.equal(cancelled.created, 0);
assert.match(cancelled.log, /中止/);
for (const settings of [{ invalidImage: true }, { duration: 0 }, { duration: 10801 }, { effectFailure: true }, { saveFailure: true }]) {
    const s = run(settings);
    assert.equal(s.saved, null);
    assert.match(s.alerts[0], /処理結果: 失敗/);
    assert.equal(s.closed, 1); // Does not discard the generated project after failure.
}
const logFailure = run({ logFailure: true });
assert.ok(logFailure.saved);
assert.match(logFailure.alerts[0], /処理結果: 成功/);
assert.match(logFailure.alerts[0], /ログ出力に失敗/);
assert.equal(run({ name: 'CON.wav' }).saved, '/output/_CON.aep');
assert.equal(run({ name: 'a:b.wav' }).saved, '/output/a_b.aep');
assert.equal(run({ name: 'song.wav', existing: ['/output/song.aep', '/output/song_001.aep'] }).saved, '/output/song_002.aep');
for (const [duration, expectedSeconds] of [[267.185555555556, 268], [0.001, 1], [12.5, 13], [12, 12], [12.00001, 13], [12.99999, 13], [10800, 10800]]) {
    const s = run({ duration });
    assert.ok(s.saved, s.alerts[0]);
    assert.equal(s.comp.duration, expectedSeconds);
    assert.equal(s.comp.workAreaDuration, s.comp.duration);
    assert.equal(s.comp.layer(1).outPoint, duration);
    assert.equal(s.comp.layer(2).outPoint, s.comp.duration);
    assert.equal(s.comp.layer(3).outPoint, s.comp.duration);
    assert.ok(s.comp.duration + 1e-12 >= duration);
    assert.ok(s.comp.duration - duration < 1);
}
const truncated = run({ duration: 267.185555555556, truncateComp: true });
assert.equal(truncated.saved, null);
assert.match(truncated.alerts[0], /実際の尺=/);
console.log('PASS: composition, spectrum, image fit, cancellation, failures, logging, filenames');
