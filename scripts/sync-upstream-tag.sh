#!/usr/bin/env bash
#---------------------------------------------------------------------------------------------
#  BlockIDE 上游同步脚本
#
#  只跟进 microsoft/vscode 的 release tag，不跟随 upstream/main。流程：
#    1. fetch 上游 tag，默认取最新的稳定 tag（形如 1.146.0）
#    2. 把 sync/upstream-<tag> 指向该 tag 本身：上游提交原样保留，不改写、不预合并
#    3. 只做一次「基线 <- tag」的合并预演，用来在报告里列出冲突文件，不提交任何结果
#    4. 冲突由 PR 呈现：GitHub 会原生标记 "This branch has conflicts"，合并按钮被禁用
#
#  用法：
#    scripts/sync-upstream-tag.sh
#    scripts/sync-upstream-tag.sh --tag 1.146.0
#    scripts/sync-upstream-tag.sh --dry-run
#
#  退出码：0 正常（status=ready 或 conflict）；1 其它错误。
#---------------------------------------------------------------------------------------------

set -eo pipefail

UPSTREAM_REMOTE="upstream"
UPSTREAM_URL="https://github.com/microsoft/vscode.git"
BASE_BRANCH="main"
TAG=""
REPORT=""
DRY_RUN=0

usage() {
	cat <<'EOF'
用法: scripts/sync-upstream-tag.sh [选项]

  --tag <tag>        跟随的上游 tag，例如 1.146.0；缺省取最新稳定 tag
  --base <branch>    BlockIDE 基线分支，默认 main
  --report <path>    额外把 Markdown 摘要写入文件（CI 用作 PR 描述）
  --dry-run          只解析 tag 与冲突预演，不创建、不保留同步分支
  -h, --help         显示本帮助
EOF
}

say() {
	printf '%s\n' "$*"
}

die() {
	printf '错误: %s\n' "$*" >&2
	exit 1
}

# 把摘要写到 stdout，并在传入 --report 时落盘。
write_report() {
	local status="$1"
	local body item
	body=$(mktemp)
	{
		printf '## 上游同步：%s\n\n' "$TAG"
		case "$status" in
			up-to-date)
				printf '基线 `%s` 已包含上游 tag `%s`，本次无需同步。\n' "$BASE_BRANCH" "$TAG"
				;;
			*)
				printf -- '- 上游 tag：`%s`\n' "$TAG"
				printf -- '- 基线：`%s` @ `%s`\n' "$BASE_BRANCH" "$BASE_SHA"
				printf -- '- 上游提交数：%s\n' "$UPSTREAM_COMMITS"
				printf -- '- 同步分支：`%s`（分支即 tag，上游提交原样保留）\n' "$BRANCH"
				if [ -n "$NEW_EXTENSION_DIRS" ]; then
					printf '\n### 上游扩展目录（BlockIDE 基线中不存在）\n\n'
					for item in $NEW_EXTENSION_DIRS; do
						printf -- '- `%s`：确认是否随包发布；不需要的话保持构建排除\n' "$item"
					done
				fi
				if [ "$status" = "conflict" ]; then
					printf '\n### 需要人工处理的冲突（%s 个）\n\n' "${#CONFLICTS[@]}"
					for item in "${CONFLICTS[@]}"; do
						printf -- '- `%s`\n' "$item"
					done
					printf '\nGitHub 会在 PR 上标记 **This branch has conflicts that must be resolved**，并禁用合并按钮。\n'
					printf '解决方式（任选其一）：\n\n'
					printf '1. 在 PR 页面点 **Resolve conflicts**；文件过大或为二进制文件时用下面的方式。\n'
					printf '2. 本地把基线合入同步分支后解决：\n\n'
					printf '```sh\ngit fetch origin\ngit switch %s\ngit merge origin/%s\n# 解决冲突后\ngit add -u\ngit commit\ngit push\n```\n' \
						"$BRANCH" "$BASE_BRANCH"
					printf '\n注意：把基线合入同步分支后，该 PR 的合并会退化为快进，不再产生合并提交；\n'
					printf '如必须保留合并提交，可在解决冲突后用 `git merge --no-ff` 手工合并到 `%s`。\n' "$BASE_BRANCH"
				else
					printf '\n### 合并方式\n\n'
					printf '无冲突。请在 PR 上使用 **Create a merge commit** 合并（不要 squash / rebase）：\n'
					printf '上游提交原样进入 `%s`，历史线性可追溯，最后只多出一个合并提交。\n' "$BASE_BRANCH"
				fi
				printf '\n### 验证\n\n'
				printf -- '- [ ] PR 上的编译、打包与冒烟检查通过\n'
				printf -- '- [ ] 手工确认品牌、内置扩展（含 minecraft-workbench）与安装包产物\n'
				;;
		esac
		printf '\n---\n由 `scripts/sync-upstream-tag.sh` 生成。\n'
	} > "$body"
	cat "$body"
	if [ -n "$REPORT" ]; then
		cp "$body" "$REPORT"
	fi
	rm -f "$body"
}

# 统一收尾：输出报告、写 GitHub Actions outputs、返回退出码。
finish() {
	local status="$1"
	local code="$2"
	write_report "$status"
	if [ -n "${GITHUB_OUTPUT:-}" ]; then
		{
			printf 'status=%s\n' "$status"
			printf 'tag=%s\n' "$TAG"
			printf 'branch=%s\n' "$BRANCH"
			printf 'base=%s\n' "$BASE_BRANCH"
		} >> "$GITHUB_OUTPUT"
	fi
	exit "$code"
}

while [ $# -gt 0 ]; do
	case "$1" in
		--tag)
			TAG="${2:?--tag 需要一个参数}"
			shift 2
			;;
		--base)
			BASE_BRANCH="${2:?--base 需要一个参数}"
			shift 2
			;;
		--report)
			REPORT="${2:?--report 需要一个参数}"
			shift 2
			;;
		--dry-run)
			DRY_RUN=1
			shift
			;;
		-h|--help)
			usage
			exit 0
			;;
		*)
			printf '未知参数: %s\n\n' "$1" >&2
			usage >&2
			exit 1
			;;
	esac
done

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || die "当前目录不是 git 仓库"
cd "$ROOT" || die "无法进入仓库根目录: $ROOT"

[ -z "$(git status --porcelain)" ] || die "工作区不干净，请先提交或储藏改动"

if ! git remote get-url "$UPSTREAM_REMOTE" >/dev/null 2>&1; then
	say "添加上游 remote: $UPSTREAM_URL"
	git remote add "$UPSTREAM_REMOTE" "$UPSTREAM_URL"
fi
git fetch "$UPSTREAM_REMOTE" --tags --prune --force --quiet ||
	die "拉取 $UPSTREAM_REMOTE 失败，请检查网络或 remote 配置"

if [ -z "$TAG" ]; then
	TAG=$(git ls-remote --tags --refs "$UPSTREAM_REMOTE" 'refs/tags/*' |
		awk -F 'refs/tags/' '{ print $2 }' |
		grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' |
		sort -V |
		tail -n 1)
	[ -n "$TAG" ] || die "未能从 $UPSTREAM_REMOTE 解析出稳定 tag"
else
	if ! git ls-remote --tags --refs "$UPSTREAM_REMOTE" "refs/tags/$TAG" |
		awk 'END { exit NR > 0 ? 0 : 1 }'; then
		die "上游不存在 tag: $TAG"
	fi
fi

TAG_REF="refs/tags/$TAG"
git rev-parse -q --verify "$TAG_REF" >/dev/null || die "本地缺少 tag $TAG，fetch 可能未完成"

if git rev-parse -q --verify "refs/heads/$BASE_BRANCH" >/dev/null; then
	BASE_REF="$BASE_BRANCH"
elif git rev-parse -q --verify "refs/remotes/origin/$BASE_BRANCH" >/dev/null; then
	BASE_REF="origin/$BASE_BRANCH"
else
	die "找不到基线分支 $BASE_BRANCH"
fi

BASE_SHA=$(git rev-parse "$BASE_REF")
BRANCH="sync/upstream-$TAG"
UPSTREAM_COMMITS=$(git rev-list --count "$BASE_SHA..$TAG_REF")
CONFLICTS=()
NEW_EXTENSION_DIRS=""

say "上游 tag: $TAG（相对基线新增 $UPSTREAM_COMMITS 个提交）"

if git merge-base --is-ancestor "$TAG_REF" "$BASE_REF"; then
	say "基线已包含 $TAG，无需同步"
	finish up-to-date 0
fi

# 同步分支直接指向上游 tag：不改写任何上游提交。
if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
	git switch --detach "$BASE_SHA" >/dev/null 2>&1 || true
	git branch -D "$BRANCH" >/dev/null 2>&1 || true
fi
git switch -c "$BRANCH" "$TAG_REF" >/dev/null || die "无法创建分支 $BRANCH"

# 合并预演：只在临时索引里算一次冲突，随后立刻回退，不提交、不留 MERGE_HEAD。
say "预演合并 $BRANCH <- $BASE_REF ..."
if ! git merge --no-ff --no-commit "$BASE_REF" >/dev/null 2>&1; then
	if ! git rev-parse -q --verify MERGE_HEAD >/dev/null; then
		git switch --detach "$BASE_SHA" >/dev/null 2>&1 || true
		git branch -D "$BRANCH" >/dev/null 2>&1 || true
		die "合并预演失败且未进入合并状态（常见原因：工作区存在会被覆盖的未跟踪文件）"
	fi
	while IFS= read -r path; do
		[ -n "$path" ] && CONFLICTS+=("$path")
	done <<< "$(git diff --name-only --diff-filter=U)"
fi
git merge --abort >/dev/null 2>&1 || true

# 上游 extensions/ 下存在、但基线中没有的目录（含 BlockIDE 侧删除后上游仍在的）。
NEW_EXTENSION_DIRS=$(LC_ALL=C comm -13 \
	<(git ls-tree -d --name-only "$BASE_SHA" extensions/ | sed 's#/$##') \
	<(git ls-tree -d --name-only "$TAG_REF" extensions/ | sed 's#/$##') || true)

STATUS=ready
if [ ${#CONFLICTS[@]} -gt 0 ]; then
	STATUS=conflict
fi

if [ "$DRY_RUN" = "1" ]; then
	git switch --detach "$BASE_SHA" >/dev/null 2>&1 || true
	git branch -D "$BRANCH" >/dev/null 2>&1 || true
	say "dry-run：$STATUS（冲突 ${#CONFLICTS[@]} 个），未创建分支"
	finish "$STATUS" 0
fi

say "同步分支 $BRANCH 指向 $TAG（$STATUS，冲突 ${#CONFLICTS[@]} 个）"
finish "$STATUS" 0
