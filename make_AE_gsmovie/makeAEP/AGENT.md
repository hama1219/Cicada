# AGENTS.md

## 目的

After Effects テンプレート `.aep` とCSVを元に、CSV 1行ごとに画像・音声・テキストを反映した個別の `.aep` を生成する ExtendScript ツールを作成する。

本ツールは `.aep` の別名保存までを対象とし、動画書き出しやレンダーキュー投入は行わない。

---

## 対象処理

- テンプレート `.aep` の読み込み
- 入力CSVの読み込み
- CSV 1行ごとのテンプレート開き直し
- 画像・音声素材の読み込み
- 画像レイヤー・音声レイヤーの追加
- 既存テキストレイヤーの差し替え
- Audio Spectrum エフェクトの参照音声設定
- 音声尺に合わせたコンポジション尺・全レイヤー尺の調整
- `.aep` の別名保存
- `process_log.txt` の出力

## 対象外

- `.mp4` / H.264 書き出し
- Adobe Media Encoder キュー追加
- After Effects レンダーキュー追加
- 出力モジュール設定
- Audio Spectrum エフェクトの新規作成・デザイン変更
- 読み込み素材のプロジェクトパネル内フォルダ整理

---

## 実行時入力

スクリプト実行時に以下を選択する。

1. テンプレート `.aep`
2. 入力CSV
3. `.aep` 保存先フォルダ

保存先フォルダはCSV全行で共通使用する。

---

## CSV仕様

### 形式

- 文字コード: UTF-8 BOMなし
- 区切り文字: カンマ
- 改行コード: CRLF / LF どちらも許容
- ヘッダー行必須
- `imagePath` / `audioPath` は絶対パス
- パス区切りは `/` 推奨。`\` も許容
- カンマ、ダブルクォート、改行を含む値はCSV標準に従いダブルクォートで囲む

### 必須カラム

```csv
outputName,imagePath,audioPath,Category_Genre,Original_Arrange,Title
```

| カラム | 用途 |
|---|---|
| `outputName` | 保存する `.aep` ファイル名のベース |
| `imagePath` | 画像ファイルの絶対パス |
| `audioPath` | 音声ファイルの絶対パス |
| `Category_Genre` | 同名テキストレイヤーへ反映 |
| `Original_Arrange` | 同名テキストレイヤーへ反映 |
| `Title` | 同名テキストレイヤーへ反映 |

### 例

```csv
outputName,imagePath,audioPath,Category_Genre,Original_Arrange,Title
gs_001,C:/assets/images/bg01.png,C:/assets/audio/music01.wav,東方アレンジ,Original,曲名サンプル
gs_002,C:/assets/images/bg02.png,C:/assets/audio/music02.wav,Lo-fi,Arrange,別の曲名
```

---

## 固定コンポジション・レイヤー

### 対象コンポジション

- 対象コンポジション名は `gs_template` 固定
- アクティブコンポジションには依存しない
- CSVでコンポジション名は指定しない

### テンプレート内に存在する前提のレイヤー

| レイヤー名 | 用途 |
|---|---|
| `Spectrum` | Audio Spectrum 設定済みレイヤー |
| `Category_Genre` | 差し替え対象テキスト |
| `Original_Arrange` | 差し替え対象テキスト |
| `Title` | 差し替え対象テキスト |

### スクリプトで追加するレイヤー

| レイヤー名 | 用途 | 配置 |
|---|---|---|
| `Background_Image` | 読み込んだ画像 | `Spectrum` の1個下 |
| `Audio_Source` | 読み込んだ音声 | `Spectrum` の1個上 |

---

## 生成処理フロー

CSVの各行について、以下を実行する。

1. テンプレート `.aep` を開き直す。
2. `gs_template` を取得する。
3. `imagePath` の画像を読み込む。
4. `audioPath` の音声を読み込む。
5. 音声素材の `duration` を取得する。
6. `gs_template.duration` を音声尺に設定する。
7. `gs_template` 内の全レイヤーの `outPoint` を音声尺に設定する。
8. 画像レイヤー `Background_Image` を追加し、`Spectrum` の1個下へ移動する。
9. 音声レイヤー `Audio_Source` を追加し、`Spectrum` の1個上へ移動する。
10. `Category_Genre`、`Original_Arrange`、`Title` の Source Text をCSV値で差し替える。
11. `Spectrum` の Audio Spectrum エフェクトの `Audio Layer` に `Audio_Source` を設定する。
12. 保存先フォルダへ `.aep` として別名保存する。
13. 次のCSV行へ進む。

前行の変更内容を戻すのではなく、毎回テンプレートを開き直すことで状態混入を防ぐ。

---

## 画像レイヤー仕様

- `imagePath` の画像を読み込み、`gs_template` に新規追加する。
- 既存画像レイヤーの差し替えは行わない。
- レイヤー名は `Background_Image` とする。
- `Spectrum` の1個下に配置する。
- `inPoint = 0`、`outPoint = 音声尺` とする。
- 画像はアスペクト比を維持し、コンポジション全体を覆うように中央配置する。
- 余白が出ないことを優先し、必要に応じて画像の一部がコンポジション外にはみ出してよい。

スケール計算方針:

```javascript
var scaleX = comp.width / imageLayer.source.width;
var scaleY = comp.height / imageLayer.source.height;
var scale = Math.max(scaleX, scaleY) * 100;

imageLayer.property("Position").setValue([comp.width / 2, comp.height / 2]);
imageLayer.property("Scale").setValue([scale, scale]);
```

---

## 音声レイヤー仕様

- `audioPath` の音声を読み込み、`gs_template` に新規追加する。
- レイヤー名は `Audio_Source` とする。
- `Spectrum` の1個上に配置する。
- `startTime = 0`、`inPoint = 0`、`outPoint = 音声尺` とする。
- この音声レイヤーを動画音声および Audio Spectrum の参照元として使用する。

---

## テキスト差し替え仕様

以下のCSVカラムを、同名のテキストレイヤーの Source Text に反映する。

| CSVカラム | 対象レイヤー |
|---|---|
| `Category_Genre` | `Category_Genre` |
| `Original_Arrange` | `Original_Arrange` |
| `Title` | `Title` |

テキスト内容のみ変更し、位置・フォント・サイズ・色・整列・アニメーション等はテンプレート設定を維持する。

---

## Audio Spectrum 設定仕様

- `Spectrum` レイヤーには Audio Spectrum エフェクトが設定済みとする。
- スクリプトではエフェクトの追加や見た目の変更は行わない。
- 既存 Audio Spectrum エフェクトの `Audio Layer` プロパティに `Audio_Source` を設定する。

---

## 尺調整仕様

- `gs_template.duration` は音声素材の `duration` に合わせる。
- `gs_template` 内の全レイヤーの `outPoint` を音声尺に設定する。
- 既存キーフレームやアニメーションは変更しない。
- 追加する画像・音声レイヤーも `inPoint = 0`、`outPoint = 音声尺` とする。

実装イメージ:

```javascript
var audioDuration = audioItem.duration;
comp.duration = audioDuration;

for (var i = 1; i <= comp.numLayers; i++) {
    comp.layer(i).outPoint = audioDuration;
}
```

---

## 保存仕様

- CSVの `outputName` を保存ファイル名のベースにする。
- 保存形式は `.aep` のみ。
- 保存先は実行時に選択したフォルダ。
- CSVには保存先カラムを持たせない。

通常保存名:

```text
{outputName}.aep
```

---

## ファイル名処理

### サニタイズ

`outputName` にWindowsファイル名として使えない文字がある場合、`_` に置換する。

対象文字:

```text
\ / : * ? " < > |
```

- 前後の空白は除去する。
- 文字列中の空白は維持する。
- サニタイズ後に空になった場合は、その行をエラーとしてスキップする。
- 置換が発生した場合はログに記録する。

### 同名回避

保存先に同名 `.aep` が存在する場合は上書きせず、3桁連番を付ける。

```text
gs_001.aep
gs_001_001.aep
gs_001_002.aep
```

連番は `001` から開始し、未使用の名前が見つかるまで増加させる。

---

## エラー処理

### 基本方針

- 行単位でエラー処理する。
- エラー行は `.aep` 保存せずスキップする。
- 1行の失敗で全体処理は止めない。
- 次行処理時は必ずテンプレート `.aep` を開き直す。

### 行スキップ対象

- 必須カラムが空
- サニタイズ後の `outputName` が空
- 画像または音声ファイルが存在しない
- 画像または音声の読み込み失敗
- `gs_template` が存在しない、またはコンポジションではない
- `Spectrum` が存在しない
- 差し替え対象テキストレイヤーが存在しない、またはテキストレイヤーではない
- Audio Spectrum エフェクトまたは `Audio Layer` プロパティが見つからない
- `Audio_Source` の参照設定に失敗
- `.aep` 保存に失敗

### 初期エラーで中断する条件

- テンプレート `.aep` 未選択
- 入力CSV未選択
- 保存先フォルダ未選択
- CSV読み込み失敗
- CSVヘッダーに必須カラムがない

---

## ログ・表示文言

### 基本方針

- ユーザー向けのログ、アラート、ダイアログ文言は日本語を基本とする。
- 行単位エラーでは都度アラートを出さず、ログに記録して処理を継続する。
- 処理完了時に成功件数、失敗件数、ログ保存先を表示する。

### ログファイル

保存先フォルダに以下のファイルを出力する。

```text
process_log.txt
```

### ログ内容

- 処理開始日時
- テンプレート `.aep` パス
- 入力CSVパス
- 保存先フォルダ
- 各行の結果
  - 行番号
  - `outputName`
  - 成功 / 失敗
  - 保存先 `.aep` パス
  - エラー理由
  - 備考
- 処理終了日時
- 成功件数
- 失敗件数

### ログ例

```text
処理開始: 2026-06-12 02:30:00
テンプレート: C:/templates/gs_template.aep
入力CSV: C:/input/list.csv
保存先フォルダ: C:/output

[成功] 2行目 outputName=gs_001 保存先=C:/output/gs_001.aep
[失敗] 3行目 outputName=gs_002 理由=画像ファイルが存在しません: C:/assets/images/bg02.png
[成功] 4行目 outputName=title:01 保存先=C:/output/title_01.aep 備考=ファイル名に使用できない文字を _ に置換しました
[成功] 5行目 outputName=gs_001 保存先=C:/output/gs_001_001.aep 備考=同名ファイルが存在したため連番を付与しました

処理終了: 2026-06-12 02:35:20
成功件数: 3
失敗件数: 1
```

---

## 実装方針

- Adobe After Effects ExtendScript `.jsx` として実装する。
- 安定性を優先し、CSV 1行ごとにテンプレート `.aep` を開き直す。
- ユーザー向け文言は日本語、内部の変数名・関数名は英語でも可。
- 素材の拡張子は厳密制限せず、存在確認後に `importFile` の成否で判定する。

---

## 未確定事項

- Audio Spectrum エフェクトおよび `Audio Layer` プロパティの厳密な検索方法
- テンプレート内に `Background_Image` / `Audio_Source` が既に存在した場合の扱い
- 読み込み後のプロジェクトアイテム名を変更するかどうか
