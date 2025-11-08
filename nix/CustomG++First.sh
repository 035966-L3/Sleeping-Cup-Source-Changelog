#!/usr/bin/bash
echo "Judger ID: 1"
g++ -Wall -std="c++$1" -o foo foo.cc -lm -O2 -I/include -DONLINE_JUDGE="Sleeping Cup" -fdiagnostics-color=always
