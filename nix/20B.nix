with import <nixpkgs> {};
writeShellApplication {
  name = "20B";
  runtimeInputs = [ coreutils ];
  text = builtins.readFile ./20B.sh;
}

