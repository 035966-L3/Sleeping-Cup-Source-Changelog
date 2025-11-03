with import <nixpkgs> {};
writeShellApplication {
  name = "23A";
  runtimeInputs = [ coreutils ];
  text = builtins.readFile ./23A.sh;
}

