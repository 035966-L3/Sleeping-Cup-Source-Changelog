import { CopyInFile, runQueued } from './sandbox';

const script = `#!/bin/bash
set -e
process_file() {
  cat $1 | awk '
    {sub(/\\r+$/,"")}
    /^$/{n=n RS};
    /./{
      printf "%s",n; n="";
      for (i=length; i>0; i--) {
        c = substr($0, i, 1);
        if (c != " " && c != "\\t" && c != "\\r") break
      }
      if (i == 0) print ""
      else print substr($0, 1, i);
    }' >$2
}
process_file file file.processed
size=$(wc -c < file.processed)
if [ "$size" -gt 1536 ]; then
  echo -e "$(head -c 1024 file.processed)...\\n[$((size - 1024)) more characters truncated]"
else
  cat file.processed
fi
`;

const fileload = async (file: CopyInFile) => { const { code, stdout } = await runQueued(`/bin/bash fileload.sh`, { copyIn: { file: file, 'fileload.sh': { content: script } }, processLimit: 32 }); if (code) return ""; return stdout; };

export default fileload;

