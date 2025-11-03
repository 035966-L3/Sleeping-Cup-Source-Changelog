#!/usr/bin/bash
/usr/bin/echo "Judger ID: 1"
/usr/bin/g++ -Wall -std=c++98 -o foo foo.cc -lm -O2 -I/include -DONLINE_JUDGE="Sleeping Cup" -fdiagnostics-color=always
