# Annotation UI version guide

Run all commands from the project root:

```sh
cd /Users/chunhua1/Downloads/swow-crosslingual-align/xlsim-annotate
```

## List the available versions

```sh
./sh/switch_annotation_version.sh status
```

## Switch annotation interfaces

Matrix-first interface:

```sh
./sh/switch_annotation_version.sh matrix
```

Pair-by-pair interface:

```sh
./sh/switch_annotation_version.sh pairs
```

Progressive row matrix with a focused pair scorer:

```sh
./sh/switch_annotation_version.sh hybrid
```

Initial project checkpoint:

```sh
./sh/switch_annotation_version.sh initial
```

The initial checkpoint is opened in detached HEAD mode. Return to a prototype
branch with one of the `matrix`, `pairs`, or `hybrid` commands above.

## If Git reports uncommitted changes

The switching script deliberately refuses to change versions when local work is
not saved. Temporarily store all tracked and untracked changes:

```sh
git stash push --include-untracked -m "work before annotation UI switch"
```

Then switch versions:

```sh
./sh/switch_annotation_version.sh matrix
./sh/switch_annotation_version.sh pairs
./sh/switch_annotation_version.sh hybrid
```

Restore the temporarily stored changes after returning to their original branch:

```sh
git stash list
git stash pop
```

## Run the selected version

```sh
npm run dev
```

Open the local URL printed by Vite, usually:

```text
http://localhost:5173/?dev=1
```

Stop the development server with `Ctrl+C`.

## Current branch and commit

```sh
git status --short --branch
git log -1 --oneline
```

