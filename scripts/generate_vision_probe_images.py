#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
generate_vision_probe_images.py —— 生成阶段 4.2b 的合成凭证测试图片

============================================================================
作用
============================================================================
读取 scripts/fixtures/vision-probe-samples.json 中的样例定义，
在 data/vision-probe/ 下生成对应的 PNG 合成凭证图片。

============================================================================
依赖前提（不做任何自动安装）
============================================================================
  · Python 3
  · Pillow（PIL）—— 仅在已安装时使用，脚本不安装、不升级任何包
  · 中文字体 —— 必须存在，否则拒绝生成（不会退化成英文样例）

字体候选（按顺序取第一个可用的）：
    C:\\Windows\\Fonts\\msyh.ttc     微软雅黑
    C:\\Windows\\Fonts\\simhei.ttf   黑体
    C:\\Windows\\Fonts\\simsun.ttc   宋体
可通过 --font 参数显式指定字体路径。

**找不到中文字体时脚本以退出码 3 结束，不生成任何图片。**
这是刻意的：本阶段的目的是为「中文图片识别」做准备，
生成英文样例会产生错误的准备结论。

============================================================================
编码
============================================================================
脚本文件本身以 UTF-8 保存；运行时强制 stdout 为 UTF-8。
读取 JSON 时显式指定 encoding="utf-8"，不使用系统默认编码。

============================================================================
安全边界
============================================================================
  · 不联网、不读取密钥、不读取 .env.local
  · 不写入图片元数据（不把期望答案藏进 PNG metadata）
  · 所有文字内容来自样例定义文件，且全部为人为合成数据

============================================================================
用法
============================================================================
    python scripts/generate_vision_probe_images.py
    python scripts/generate_vision_probe_images.py --font "C:\\Windows\\Fonts\\simhei.ttf"
    python scripts/generate_vision_probe_images.py --dry-run

退出码：
    0  成功（或 dry-run 成功）
    2  样例定义文件缺失或格式不符
    3  找不到可用的中文字体 —— 未生成任何图片
    4  Pillow 未安装 —— 未生成任何图片
    5  写入失败
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# 输出统一使用 UTF-8，避免 Windows 控制台默认代码页把中文变成乱码
# ---------------------------------------------------------------------------
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:  # noqa: BLE001 - 老环境可能不支持 reconfigure
    pass


# ---------------------------------------------------------------------------
# 路径常量（均相对仓库根目录）
# ---------------------------------------------------------------------------
REPO_ROOT = Path(__file__).resolve().parent.parent
SAMPLES_FILE = REPO_ROOT / "scripts" / "fixtures" / "vision-probe-samples.json"
OUTPUT_DIR = REPO_ROOT / "data" / "vision-probe"

# ---------------------------------------------------------------------------
# 字体候选：按优先级排列，取第一个能被 Pillow 成功加载的
# ---------------------------------------------------------------------------
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyh.ttc",     # 微软雅黑
    r"C:\Windows\Fonts\simhei.ttf",   # 黑体
    r"C:\Windows\Fonts\simsun.ttc",   # 宋体
]

# ---------------------------------------------------------------------------
# 画布与排版参数
# ---------------------------------------------------------------------------
IMAGE_WIDTH = 900
IMAGE_HEIGHT = 560
PADDING = 48
MARGIN = 22            # 外框留白
BORDER_WIDTH = 2

COLOR_BG = (255, 255, 255)
COLOR_BORDER = (203, 213, 225)      # slate-300
COLOR_TITLE = (15, 23, 42)          # slate-900
COLOR_LABEL = (100, 116, 139)       # slate-500
COLOR_VALUE = (15, 23, 42)          # slate-900
COLOR_WATERMARK = (148, 163, 184)   # slate-400
COLOR_DIVIDER = (226, 232, 240)     # slate-200

SIZE_TITLE = 26
SIZE_LABEL = 20
SIZE_VALUE = 24
SIZE_WATERMARK = 15

LINE_GAP = 22          # 行间额外间距
LABEL_COLUMN_WIDTH = 170


def load_font(size: int, explicit_path: str | None):
    """加载中文字体。

    返回 (font, used_path)。全部候选都失败时返回 (None, None)。
    """
    from PIL import ImageFont  # 局部导入，便于在未安装时给出清晰提示

    candidates = [explicit_path] if explicit_path else []
    candidates += FONT_CANDIDATES

    for candidate in candidates:
        if not candidate:
            continue
        if not Path(candidate).exists():
            continue
        try:
            font = ImageFont.truetype(candidate, size)
            # 用真实汉字验证字形可排版，且宽度非零
            bbox = font.getbbox("合成测试凭证")
            if bbox and (bbox[2] - bbox[0]) > 0:
                return font, candidate
        except Exception:  # noqa: BLE001 - 单个字体失败不应中断整个候选扫描
            continue

    return None, None


def load_samples() -> list[dict]:
    """读取样例定义（显式 UTF-8）。"""
    if not SAMPLES_FILE.exists():
        print(f"[错误] 样例定义文件不存在：{SAMPLES_FILE}", file=sys.stderr)
        raise SystemExit(2)

    try:
        raw = SAMPLES_FILE.read_text(encoding="utf-8")
        data = json.loads(raw)
    except UnicodeDecodeError as exc:
        print(f"[错误] 样例定义文件不是有效 UTF-8：{exc}", file=sys.stderr)
        raise SystemExit(2)
    except json.JSONDecodeError as exc:
        print(f"[错误] 样例定义文件不是有效 JSON：{exc}", file=sys.stderr)
        raise SystemExit(2)

    samples = data.get("samples")
    if not isinstance(samples, list) or not samples:
        print("[错误] 样例定义缺少非空的 samples 数组。", file=sys.stderr)
        raise SystemExit(2)

    return samples


def draw_sample(sample: dict, out_dir: Path, font_path: str | None, dry_run: bool) -> dict:
    """绘制单张合成凭证，返回尺寸与字节数信息。"""
    from PIL import Image, ImageDraw

    print_def = sample.get("print") or {}
    title = print_def.get("title")
    rows = print_def.get("rows") or []
    footer = print_def.get("footer")

    if not isinstance(title, str) or not title.strip():
        print(f"[错误] 样例 {sample.get('id')} 缺少 title。", file=sys.stderr)
        raise SystemExit(2)
    if not isinstance(rows, list) or not rows:
        print(f"[错误] 样例 {sample.get('id')} 缺少 rows。", file=sys.stderr)
        raise SystemExit(2)

    font_title, used_font = load_font(SIZE_TITLE, font_path)
    if font_title is None:
        print(
            "[错误] 找不到可用的中文字体，已停止生成。\n"
            "       候选：" + " | ".join(FONT_CANDIDATES) + "\n"
            "       可用 --font 显式指定字体路径。\n"
            "       本脚本不会用英文样例代替中文样例，也不会下载字体。",
            file=sys.stderr,
        )
        raise SystemExit(3)

    font_label, _ = load_font(SIZE_LABEL, font_path)
    font_value, _ = load_font(SIZE_VALUE, font_path)
    font_watermark, _ = load_font(SIZE_WATERMARK, font_path)

    image = Image.new("RGB", (IMAGE_WIDTH, IMAGE_HEIGHT), COLOR_BG)
    draw = ImageDraw.Draw(image)

    # ---- 外框 ----
    draw.rectangle(
        [MARGIN, MARGIN, IMAGE_WIDTH - MARGIN, IMAGE_HEIGHT - MARGIN],
        outline=COLOR_BORDER,
        width=BORDER_WIDTH,
    )

    cursor_y = PADDING + 4

    # ---- 标题 ----
    draw.text((PADDING, cursor_y), title, font=font_title, fill=COLOR_TITLE)
    title_h = font_title.getbbox(title)[3] - font_title.getbbox(title)[1]
    cursor_y += title_h + 18

    # ---- 标题下分隔线 ----
    draw.line(
        [(PADDING, cursor_y), (IMAGE_WIDTH - PADDING, cursor_y)],
        fill=COLOR_DIVIDER,
        width=2,
    )
    cursor_y += LINE_GAP + 6

    # ---- 字段行 ----
    row_boxes = []
    for row in rows:
        label = row.get("label")
        value = row.get("value")
        if not isinstance(label, str) or not isinstance(value, str):
            print(f"[错误] 样例 {sample.get('id')} 的行定义不完整。", file=sys.stderr)
            raise SystemExit(2)

        draw.text((PADDING, cursor_y), label, font=font_label, fill=COLOR_LABEL)
        draw.text(
            (PADDING + LABEL_COLUMN_WIDTH, cursor_y),
            value,
            font=font_value,
            fill=COLOR_VALUE,
        )

        value_bbox = font_value.getbbox(value)
        value_h = value_bbox[3] - value_bbox[1]
        row_boxes.append(
            {
                "label": label,
                "value": value,
                "y": cursor_y,
                "height": value_h,
            }
        )
        cursor_y += max(value_h, SIZE_LABEL) + LINE_GAP

    # ---- 底部水印（不属于凭证字段，不会被误认为字段值） ----
    if isinstance(footer, str) and footer.strip():
        wm_bbox = font_watermark.getbbox(footer)
        wm_w = wm_bbox[2] - wm_bbox[0]
        wm_h = wm_bbox[3] - wm_bbox[1]
        draw.text(
            (IMAGE_WIDTH - PADDING - wm_w, IMAGE_HEIGHT - PADDING - wm_h),
            footer,
            font=font_watermark,
            fill=COLOR_WATERMARK,
        )

    # ---- 垂直空间校验：内容不得触底 ----
    bottom_limit = IMAGE_HEIGHT - MARGIN - 12
    if row_boxes and (row_boxes[-1]["y"] + row_boxes[-1]["height"]) > bottom_limit:
        print(
            f"[错误] 样例 {sample.get('id')} 内容超出画布底部，拒绝写入。",
            file=sys.stderr,
        )
        raise SystemExit(5)

    out_path = out_dir / sample["imageFile"]

    if dry_run:
        return {
            "id": sample.get("id"),
            "file": str(out_path),
            "width": IMAGE_WIDTH,
            "height": IMAGE_HEIGHT,
            "bytes": None,
            "font": used_font,
            "rows": len(row_boxes),
            "dry_run": True,
        }

    out_dir.mkdir(parents=True, exist_ok=True)
    try:
        # 不传任何 metadata 参数，也不写 pnginfo —— 不把答案藏进图片
        image.save(out_path, format="PNG", optimize=True)
    except Exception as exc:  # noqa: BLE001
        print(f"[错误] 写入失败 {out_path}：{exc}", file=sys.stderr)
        raise SystemExit(5)

    return {
        "id": sample.get("id"),
        "file": str(out_path),
        "width": image.width,
        "height": image.height,
        "bytes": out_path.stat().st_size,
        "font": used_font,
        "rows": len(row_boxes),
        "dry_run": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="生成阶段 4.2b 的合成凭证测试图片（不联网、不安装依赖）",
    )
    parser.add_argument(
        "--font",
        default=None,
        help="显式指定中文字体文件路径；不指定时按内置候选顺序查找",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="只校验字体与排版，不写入任何文件",
    )
    args = parser.parse_args()

    try:
        import PIL  # noqa: F401
    except ImportError:
        print(
            "[错误] 未安装 Pillow，已停止。\n"
            "       本脚本不会自动安装依赖。请先在本机准备 Pillow 后重试。\n"
            "       若本机无 Pillow，请改用其他已有工具生成图片，",
            file=sys.stderr,
        )
        raise SystemExit(4)

    samples = load_samples()

    print("=" * 66)
    print("阶段 4.2b 合成凭证图片生成")
    print("=" * 66)
    print(f"样例定义 : {SAMPLES_FILE.relative_to(REPO_ROOT)}")
    print(f"输出目录 : {OUTPUT_DIR.relative_to(REPO_ROOT)}/")
    print(f"模式     : {'dry-run（不写文件）' if args.dry_run else '实际生成'}")
    print()

    results = []
    for sample in samples:
        info = draw_sample(sample, OUTPUT_DIR, args.font, args.dry_run)
        results.append(info)
        size_text = f"{info['bytes']} 字节" if info["bytes"] is not None else "（未写入）"
        print(f"  [{info['id']}]")
        print(f"    文件   : {Path(info['file']).name}")
        print(f"    尺寸   : {info['width']} x {info['height']} px")
        print(f"    体积   : {size_text}")
        print(f"    字段行 : {info['rows']} 行")
        print(f"    字体   : {info['font']}")
        print()

    print("-" * 66)
    print(f"完成：{len(results)} 张{'（dry-run，未写入磁盘）' if args.dry_run else ''}")
    print("注意：这些图片是人为合成数据，不含真实凭证、商户、个人信息或订单。")
    print("-" * 66)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
