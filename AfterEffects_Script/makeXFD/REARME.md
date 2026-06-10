# makeXFD 使い方

`src/makeXFD.jsx` は、CSV に記載した CD 情報・楽曲情報・ジャケット画像・音声ファイルから、After Effects の XFD 用コンポジションを自動生成する ExtendScript です。

## ファイル配置

CSV、ジャケット画像、音声ファイルは同じフォルダに置いてください。CSV 内のファイル名は、このフォルダから見たファイル名として記載します。

```text
XFD素材/
  makexfd.csv
  jacket.png
  track01.wav
  track02.wav
  track03.wav
```

## CSV の書き方

CSV は UTF-8 で保存してください。項目内のカンマ、ダブルクォート付き CSV には未対応です。

1行目は CD 情報です。

```csv
CDタイトル,日付,イベント名,価格,曲数,使用する画像ファイル名
```

2行目以降は楽曲情報です。開始位置・終了位置は、各音声ファイル内で実際に聴かせたい区間を秒で指定します。

```csv
音声ファイル名,楽曲名,原曲名,開始位置（秒）,終了位置（秒）
```

記載例:

```csv
Sample Album,2026-06-10,Sample Event,1000円,3,jacket.png
track01.wav,Opening Theme,Original Song A,12.5,42.5
track02.wav,Battle Arrange,Original Song B,8,38
track03.wav,Ending Remix,Original Song C,20,50
```

## After Effects への取り込みと実行

1. After Effects を起動します。
2. `ファイル > スクリプト > スクリプトファイルを実行...` を選びます。
3. `AfterEffects_Script/makeXFD/src/makeXFD.jsx` を選択します。
4. CSV 選択ダイアログで、作成した `makexfd.csv` を選択します。
5. CSV と同じフォルダの画像・音声が読み込まれ、`XFD_<CDタイトル>` というコンポジションが作成されます。

## 補足

- ジャケット画像は正方形を想定しています。
- 音声は曲間 3 秒でクロスフェードします。
- テキストは 1 秒フェードし、前曲と次曲のテキストは 0.5 秒重なります。
- 指定した画像・音声ファイルが見つからない場合、エラーを表示して処理を中断します。
