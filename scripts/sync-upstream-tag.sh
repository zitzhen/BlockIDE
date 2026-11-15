#!/usr/bin/env bash
#---------------------------------------------------------------------------------------------
#  BlockIDE 上游同步脚本
#
#  只跟进 microsoft/vscode 的 release tag，不跟随 upstream/main。流程：
#    1. fetch 上游 tag，默认取最新的稳定 tag（形如 1.146.0）
#    2. 从基线分支创建 sync/upstream-<tag>，做一次 --no-ff 合并
#    3. 自动解决「BlockIDE 侧已删除、上游又修改」的 modify/delete 冲突（保持删除）
#    4. 仍有冲突时带冲突标记提交，交给 PR 继续解决（--abort-on-conflict 可改为中止）
#
#  用法：
#    scripts/sync-upstream-tag.sh
#    scripts/sync-upstream-tag.sh --tag 1.146.0
#    scripts/sync-upstream-tag.sh --dry-run
#    scripts/sync-upstream-tag.sh --prefer-ours 'test/smoke/**'
#
#  退出码：0 成功（已合并 / 无需合并 / dry-run）；2 仅在使用 --abort-on-conflict 时出现
#          需人工处理的冲突；1 其它错误。
#---------------------------------------------------------------------------------------------

set -eo pipefail

UPSTREAM_REMOTE="upstream"
UPSTREAM_URL="https://github.com/microsoft/vscode.git"
BASE_BRANCH="main"
TAG=""
REPORT=""
DRY_RUN=0
ABORT_ON_CONFLICT=0
PREFER_OURS=()

usage() {
	cat <<'EOF'
用法: scripts/sync-upstream-tag.sh [选项]

  --tag <tag>            跟随的上游 tag，例如 1.146.0；缺省取最新稳定 tag
  --base <branch>        BlockIDE 基线分支，默认 main
  --prefer-ours <glob>   冲突时保留 BlockIDE 一侧的路径 glob，可重复或用逗号分隔
  --report <path>        额外把 Markdown 摘要写入文件（CI 用作 PR 描述）
  --dry-run              只做合并与冲突检查，不提交、不保留分支
  --abort-on-conflict    存在人工冲突时中止合并并退出 2（默认是带冲突标记提交）
  -h, --help             显示本帮助
EOF
}

say() {
	printf '%s\n' "$*"
}

die() {
	printf '错误: %s\n' "$*" >&2
	exit 1
}

# 判断某个冲突路径是否在 BlockIDE 侧被删除（merge 的 stage 2 缺失）。
is_deleted_by_us() {
	local path="$1"
	local stages
	stages=$(git ls-files -u -- "$path" | awk '{ print $3 }' | sort -u | tr '\n' ' ')
	case " $stages " in
		*" 2 "*) return 1 ;;
	esac
	return 0
}

# 冲突路径是否命中 --prefer-ours 的 glob。
matches_prefer_ours() {
	local path="$1"
	local pattern
	for pattern in "${PREFER_OURS[@]}"; do
		# shellcheck disable=SC2053 # 右侧有意作为 glob 使用
		if [[ "$path" == $pattern ]]; then
			return 0
		fi
	done
	return 1
}

# 回到基线分支；本地没有基线分支时退回 detached HEAD。
back_to_base() {
	if git rev-parse -q --verify "refs/heads/$BASE_BRANCH" >/dev/null; then
		git switch "$BASE_BRANCH" >/dev/null 2>&1 || true
	else
		git switch --detach "$BASE_REF" >/dev/null 2>&1 || true
	fi
}

# 把摘要写到 stdout，并在传入 --report 时落盘。
write_report() {
	local status="$1"
	local body
	local item
	body=$(mktemp)
	{
		printf '## 上游同步：%s\n\n' "$TAG"
		case "$status" in
			up-to-date)
				printf '基线 `%s` 已包含上游 tag `%s`，本次无需合并。\n' "$BASE_BRANCH" "$TAG"
				;;
			merged)
				printf -- '- 上游 tag：`%s`\n' "$TAG"
				printf -- '- 基线：`%s` @ `%s`\n' "$BASE_BRANCH" "$BASE_SHA"
				printf -- '- 上游提交数：%s\n' "$UPSTREAM_COMMITS"
				printf -- '- 同步分支：`%s`\n' "$BRANCH"
				printf -- '- 变更统计：`%s`\n' "$(git diff --shortstat "$BASE_SHA" "$BRANCH" | sed 's/^ //')"
				if [ ${#RESOLVED[@]} -gt 0 ]; then
					printf '\n### 自动解决的冲突\n\n'
					for item in "${RESOLVED[@]}"; do
						printf -- '- %s\n' "$item"
					done
				fi
				if [ -n "$NEW_EXTENSION_DIRS" ]; then
					printf '\n### 上游新增的内置扩展目录\n\n'
					for item in $NEW_EXTENSION_DIRS; do
						printf -- '- `%s`：确认是否随包发布；不需要的话请删除并加入构建排除清单\n' "$item"
					done
				fi
				printf '\n### 验证\n\n'
				printf -- '- [ ] PR 上的编译、打包与冒烟检查通过\n'
				printf -- '- [ ] 手工确认品牌、内置扩展（含 minecraft-workbench）与安装包产物\n'
				;;
			dry-run)
				printf -- '- 上游 tag：`%s`\n' "$TAG"
				printf -- '- 基线：`%s` @ `%s`\n' "$BASE_BRANCH" "$BASE_SHA"
				printf -- '- 上游提交数：%s\n' "$UPSTREAM_COMMITS"
				printf '\n合并可行，dry-run 未创建提交。\n'
				if [ ${#RESOLVED[@]} -gt 0 ]; then
					printf '\n### 自动解决的冲突\n\n'
					for item in "${RESOLVED[@]}"; do
						printf -- '- %s\n' "$item"
					done
				fi
				;;
			conflict|dry-run-conflict|conflict-aborted)
				printf -- '- 上游 tag：`%s`\n' "$TAG"
				printf -- '- 基线：`%s` @ `%s`\n' "$BASE_BRANCH" "$BASE_SHA"
				printf -- '- 上游提交数：%s\n' "$UPSTREAM_COMMITS"
				if [ ${#RESOLVED[@]} -gt 0 ]; then
					printf '\n### 自动解决的冲突\n\n'
					for item in "${RESOLVED[@]}"; do
						printf -- '- %s\n' "$item"
					done
				fi
				printf '\n### 需要人工处理的冲突\n\n'
				for item in "${STILL[@]}"; do
					printf -- '- `%s`\n' "$item"
				done
				if [ "$status" = "conflict" ]; then
					printf '\n合并结果已提交到 `%s`，文件里保留了冲突标记（`<<<<<<<` / `=======` / `>>>>>>>`），\n' "$BRANCH"
					printf 'PR 以 draft 形式创建，在该分支上解决后推送即可。合并前请确认所有标记都已删除。\n'
					printf '冲突解决前 PR 的编译检查会失败，这是预期行为。\n'
					printf '\n本地继续：\n\n'
					printf '```sh\ngit fetch origin %s\ngit switch %s\n# 编辑上面列出的文件，删除冲突标记\ngit add -u\ngit commit -m "fix: resolve upstream %s conflicts"\ngit push\n```\n' \
						"$BRANCH" "$BRANCH" "$TAG"
				elif [ "$status" = "conflict-aborted" ]; then
					printf '\n已在本地中止合并，未产生提交。本地处理：\n\n'
					printf '```sh\ngit fetch %s --tags\ngit switch -c %s %s\ngit merge --no-ff %s\n# 解决冲突后\ngit commit\n```\n' \
						"$UPSTREAM_REMOTE" "$BRANCH" "$BASE_BRANCH" "$TAG"
				else
					printf '\ndry-run 未提交，以上冲突需要在正式同步时处理。\n'
				fi
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
		--prefer-ours)
			IFS=',' read -r -a patterns <<< "${2:?--prefer-ours 需要一个参数}"
			for pattern in "${patterns[@]}"; do
				if [ -n "$pattern" ]; then
					PREFER_OURS+=("$pattern")
				fi
			done
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
		--abort-on-conflict)
			ABORT_ON_CONFLICT=1
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
git config user.email >/dev/null 2>&1 || die "未配置 git user.email"

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
RESOLVED=()
STILL=()
NEW_EXTENSION_DIRS=""

say "上游 tag: $TAG（相对基线新增 $UPSTREAM_COMMITS 个提交）"

if git merge-base --is-ancestor "$TAG_REF" "$BASE_REF"; then
	say "基线已包含 $TAG，无需合并"
	finish up-to-date 0
fi

if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
	back_to_base
	git branch -D "$BRANCH" >/dev/null 2>&1 || true
fi
git switch -c "$BRANCH" "$BASE_REF" >/dev/null || die "无法创建分支 $BRANCH"

say "合并 $TAG 到 $BRANCH ..."
if ! merge_output=$(git merge --no-ff --no-commit "$TAG_REF" 2>&1); then
	say "$merge_output"
fi

if ! git rev-parse -q --verify MERGE_HEAD >/dev/null; then
	die "git merge 未进入合并状态，请检查上方输出"
fi

while IFS= read -r path; do
	[ -n "$path" ] || continue
	if is_deleted_by_us "$path"; then
		git rm -q -f -- "$path"
		RESOLVED+=("$path（BlockIDE 侧已删除，保持删除）")
	elif matches_prefer_ours "$path" && git checkout --ours -- "$path" 2>/dev/null && git add -- "$path"; then
		RESOLVED+=("$path（按 --prefer-ours 保留 BlockIDE 版本）")
	fi
done <<< "$(git diff --name-only --diff-filter=U)"

STILL_PATHS=$(git diff --name-only --diff-filter=U)
while IFS= read -r path; do
	[ -n "$path" ] || continue
	STILL+=("$path")
done <<< "$STILL_PATHS"

if [ ${#STILL[@]} -gt 0 ]; then
	if [ "$ABORT_ON_CONFLICT" = "1" ]; then
		git merge --abort
		back_to_base
		git branch -D "$BRANCH" >/dev/null 2>&1 || true
		say "存在 $(( ${#STILL[@]} )) 个需要人工处理的冲突，已中止合并"
		finish conflict-aborted 2
	fi
	if [ "$DRY_RUN" = "1" ]; then
		git merge --abort
		back_to_base
		git branch -D "$BRANCH" >/dev/null 2>&1 || true
		say "dry-run：存在 $(( ${#STILL[@]} )) 个需要人工处理的冲突"
		finish dry-run-conflict 0
	fi
	say "存在 $(( ${#STILL[@]} )) 个需要人工处理的冲突，将带冲突标记提交，供 PR 继续解决"
elif [ "$DRY_RUN" = "1" ]; then
	git merge --abort
	back_to_base
	git branch -D "$BRANCH" >/dev/null 2>&1 || true
	say "dry-run 通过：合并无遗留冲突"
	finish dry-run 0
fi

COMMIT_BODY="上游 tag: $TAG
基线: $BASE_BRANCH @ $BASE_SHA
上游提交: $UPSTREAM_COMMITS"

if [ ${#RESOLVED[@]} -gt 0 ]; then
	COMMIT_BODY="$COMMIT_BODY

自动解决的冲突:
$(for item in "${RESOLVED[@]}"; do printf -- '- %s\n' "$item"; done)"
fi

STATUS=merged
if [ ${#STILL[@]} -gt 0 ]; then
	COMMIT_BODY="$COMMIT_BODY

存在未解决的冲突（已按带冲突标记的文件提交）:
$(for item in "${STILL[@]}"; do printf -- '- %s\n' "$item"; done)"
	git add -u
	STATUS=conflict
fi

git commit -q -m "chore: sync upstream $TAG" -m "$COMMIT_BODY" || die "创建合并提交失败"

# 上游新增的内置扩展目录：既包括上游新扩展，也包括被 BlockIDE 删除后又被上游加回文件的目录。
NEW_EXTENSION_DIRS=$(LC_ALL=C comm -13 \
	<(git ls-tree -d --name-only "$BASE_SHA" extensions/ | sed 's#/$##') \
	<(git ls-tree -d --name-only "$BRANCH" extensions/ | sed 's#/$##') || true)
if [ -n "$NEW_EXTENSION_DIRS" ]; then
	say "注意：合并结果出现新的内置扩展目录：$(printf '%s ' $NEW_EXTENSION_DIRS)"
fi

say "已创建合并提交：$(git rev-parse --short HEAD)（分支 $BRANCH，状态 $STATUS）"
finish "$STATUS" 0
