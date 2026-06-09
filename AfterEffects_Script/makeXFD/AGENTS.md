# AGENTS.md - makeXFD.jsx

## 目的

Adobe After Effects 上で実行する ExtendScript (`makeXFD.jsx`) を実装する。
CSV から CD 情報・楽曲情報・画像・音声を読み込み、YouTube 投稿向けのクロスフェードデモ動画用コンポジションを自動生成する。

スクリプト実行時は CSV 選択ダイアログを表示し、選択された CSV の内容に従って、コンポジション、画像レイヤー、音声レイヤー、テキストレイヤーを作成する。

## 実行環境・実装方針

- Adobe After Effects の ExtendScript (`.jsx`) として実行する。
- ES6 以降の構文は避け、`var` と通常の `function` を基本とする。
- 処理全体は `app.beginUndoGroup()` / `app.endUndoGroup()` で囲む。
- レイヤー生成、CSV解析、クロスフェード計算は関数化する。

## CSV仕様

### 1行目: CD情報

```csv
CDタイトル,日付,イベント名,価格,曲数,使用する画像ファイル名
```

- `使用する画像ファイル名` は CD ジャケット画像として扱う。

### 2行目以降: 楽曲情報

```csv
音声ファイル名,楽曲名,原曲名,開始位置（秒）,終了位置（秒）
```

- 各行を上から順に楽曲順として扱う。
- `開始位置（秒）` と `終了位置（秒）` は、実際に聴かせたい中心区間とする。

### CSV読み込み

- CSV は UTF-8 として読み込む。
- 読み込み時は `File.encoding = "UTF-8"` を指定する。
- UTF-8 BOM がある場合は除去する。
- 初期実装では、項目内のカンマおよびダブルクォートエスケープは対象外とする。
- CSVパース処理は関数化し、単純な `split(",")` を直接インラインに書かない。

## 素材ファイル

- CSV ファイルと同じディレクトリを基準ディレクトリとする。
- 画像ファイル・音声ファイルは原則として CSV と同じディレクトリから探索する。
- 指定ファイルが存在しない場合は、対象ファイル名を含むエラーを表示して処理を中断する。

## コンポジション仕様

- コンポジション名: `XFD_<CDタイトル>`
- 解像度: `1280 x 720`
- アスペクト比: `16:9`
- フレームレート: `30fps`
- ピクセル縦横比: `Square Pixels (1.0)`
- YouTube 投稿向け HD 720p / SDR 前提
- 動画総尺: `クロスフェード本編尺 + 7秒`
- クロスフェード本編尺は、最後の音声レイヤーのタイムライン上の終了時刻を基準とする。

## 画面レイアウト

```text
左側テキスト領域: x=0   ～ 560,  y=0 ～ 720, width=560, height=720
右側画像領域:     x=560 ～ 1280, y=0 ～ 720, width=720, height=720
```

## 画像レイヤー仕様

- CSV 1行目の `使用する画像ファイル名` を CD ジャケット画像として読み込む。
- 画像は正方形、アスペクト比 `1:1` を想定する。
- 画像レイヤー名: `Image_CD_Jacket`
- コンポジション全体を通して表示する。
- 表示サイズは `720 x 720` とする。
- 右詰めで配置し、上下はコンポジション端に合わせる。
- レイヤーのアンカーポイントが中央の場合の位置:

```javascript
positionX = 920;
positionY = 360;
```

- 実装では以下の計算を使用する。

```javascript
imageSize = compHeight; // 720
positionX = compWidth - imageSize / 2;
positionY = compHeight / 2;
scalePercent = imageSize / sourceImageWidth * 100;
```

- 画像が正方形でない場合は警告対象とする。

## 音声レイヤー仕様

- CSV 2行目以降の各楽曲に対して、1つの音声レイヤーを作成する。
- 音声レイヤー名: `Audio_<トラック番号>_<楽曲名>`
- 音声クロスフェード時間は全曲共通で `3秒` とする。
- CSVの開始位置・終了位置の前後に3秒を追加して使用する。
- 音声素材として存在しない範囲は作成せず、音声ファイル範囲内に補正する。

### 音声範囲計算

```text
実音声開始位置 = max(0, CSV開始位置 - 3秒)
実音声終了位置 = min(音声ファイル長, CSV終了位置 + 3秒)
```

### 音声レイヤーの切り出し

After Effects で音声ファイル内の `actualStart` 秒地点から再生するため、`inPoint` / `outPoint` だけでなく `startTime` を必ず設定する。

```javascript
layer.startTime = timelineStart - actualStart;
layer.inPoint = timelineStart;
layer.outPoint = timelineStart + actualDuration;
```

## 音量フェード仕様

- 通常音量: `[0, 0]` dB
- 無音相当: `[-48, -48]` dB
- Audio Levels は左右チャンネル配列で指定する。
- `0` を無音として扱わない。`0dB` は通常音量である。

```javascript
AUDIO_NORMAL_LEVEL = [0, 0];
AUDIO_SILENT_LEVEL = [-48, -48];
```

各音声レイヤーには以下のキーフレームを設定する。

```text
レイヤー開始時点: 無音相当
フェードイン終了時点: 通常音量
フェードアウト開始時点: 通常音量
レイヤー終了時点: 無音相当
```

## クロスフェード計算関数

クロスフェード関連の計算は必ず以下の関数に分離する。

```javascript
calculateAudioRange(csvStart, csvEnd, audioDuration, fadeDuration)
calculateTimelinePlacement(previousEndTime, fadeDuration)
calculateFadeDuration(csvStart, csvEnd, audioDuration, fadeDuration)
```

### calculateAudioRange

```javascript
actualStart = Math.max(0, csvStart - fadeDuration);
actualEnd = Math.min(audioDuration, csvEnd + fadeDuration);
actualDuration = actualEnd - actualStart;
```

戻り値:

```javascript
{
  actualStart: Number,
  actualEnd: Number,
  actualDuration: Number
}
```

### calculateTimelinePlacement

- 1曲目は `0秒` から配置する。
- 2曲目以降は、前曲終了時刻から `fadeDuration` を差し引いて配置する。

```javascript
timelineStart = previousEndTime - fadeDuration;
```

戻り値:

```javascript
{
  timelineStart: Number
}
```

### calculateFadeDuration

```javascript
fadeInDuration = Math.min(fadeDuration, csvStart);
fadeOutDuration = Math.min(fadeDuration, audioDuration - csvEnd);
```

戻り値:

```javascript
{
  fadeInDuration: Number,
  fadeOutDuration: Number
}
```

## テキストレイヤー仕様

### 表示内容

CSV 2行目以降の各楽曲について、以下の2つを表示する。

- 上段: 楽曲名
- 下段: 原曲名

テキストレイヤー名:

```text
Text_<トラック番号>_TrackTitle
Text_<トラック番号>_OriginalTitle
```

### 配置・折り返し

- 左側テキスト領域内に配置する。
- 左余白は `40px` とする。
- 左詰めで表示する。
- 長い文字列は折り返し表示する。
- 自動縮小は行わない。
- ポイントテキストではなく、ボックステキストを使用する。

固定ボックス領域:

```javascript
TRACK_TITLE_BOX_X = 40;
TRACK_TITLE_BOX_Y = 250;
TRACK_TITLE_BOX_WIDTH = 520;
TRACK_TITLE_BOX_HEIGHT = 160;

ORIGINAL_TITLE_BOX_X = 40;
ORIGINAL_TITLE_BOX_Y = 430;
ORIGINAL_TITLE_BOX_WIDTH = 520;
ORIGINAL_TITLE_BOX_HEIGHT = 120;
```

- 楽曲名が折り返されても、原曲名の位置は固定とする。
- ボックス内に収まらない場合は警告対象とする。

### フォントサイズ

- 動画全体でフォントサイズは統一する。
- 楽曲ごとにフォントサイズを変更しない。
- 楽曲名と原曲名の比率は `3:2` とする。

```javascript
TRACK_TITLE_FONT_SIZE = 60;
ORIGINAL_TITLE_FONT_SIZE = 40;
```

## テキスト切り替え演出

- 楽曲切り替わり時、前曲テキストと次曲テキストを `1秒` 重ねる。
- 不透明度でクロスフェードする。
- 前曲: `100% → 0%`
- 次曲: `0% → 100%`
- テキストフェード時間は音声フェードとは別管理にする。

```javascript
TEXT_FADE_DURATION = 1;
AUDIO_FADE_DURATION = 3;
```

各テキストレイヤーの表示タイミングは、対応する音声レイヤーのタイムライン配置結果を基準にする。

```text
textStartTime = audioTimelineStart
textEndTime = audioTimelineEnd
```

不透明度キーフレーム:

```text
textStartTime: 0%
textStartTime + TEXT_FADE_DURATION: 100%
textEndTime - TEXT_FADE_DURATION: 100%
textEndTime: 0%
```

楽曲名・原曲名の両方に同じフェードを適用する。

## エラー処理

以下の場合は処理を中断し、エラーを表示する。

- CSV が選択されなかった
- CSV が読み込めない
- CSV の行数または項目数が不足している
- 画像ファイルまたは音声ファイルが存在しない
- 開始位置・終了位置が数値ではない
- `csvStart < 0`
- `csvEnd <= csvStart`
- `csvEnd > audioDuration`

## 実装禁止事項

- `calculateAudioRange` / `calculateTimelinePlacement` / `calculateFadeDuration` を省略しない。
- クロスフェード計算を複数箇所に重複記述しない。
- 音声切り出しで `startTime` 設定を省略しない。
- Audio Levels の無音値に `0` を使用しない。
- Audio Levels に単一数値のみを渡さない。
- テキストのフォントサイズを曲ごとに変更しない。
- 長い文字列に対して自動縮小しない。
- 右側 CD ジャケット領域にテキストを重ねない。
- ExtendScript で不安定な ES6 構文を使用しない。

## 今後の検討事項

以下は現時点では未実装または将来的な拡張項目とする。

- CSV のダブルクォートエスケープ対応
- CDタイトル、日付、イベント名、価格、曲数の画面表示
- エンディング7秒区間の具体的な表示内容
- 画像の背景ぼかし・ズーム演出
- 1080p など他解像度への対応
- フォント名、文字色、縁取り、影などの詳細デザイン指定
