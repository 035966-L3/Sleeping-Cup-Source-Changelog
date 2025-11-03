with import <nixpkgs> {};
writeShellApplication {
  name = "03A";
  runtimeInputs = [ coreutils ];
  text = builtins.readFile ./03A.sh;
}

