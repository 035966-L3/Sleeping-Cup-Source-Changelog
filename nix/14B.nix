with import <nixpkgs> {};
writeShellApplication {
  name = "14B";
  runtimeInputs = [ coreutils ];
  text = builtins.readFile ./14B.sh;
}

