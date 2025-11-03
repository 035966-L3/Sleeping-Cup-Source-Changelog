with import <nixpkgs> {};
writeShellApplication {
  name = "03B";
  runtimeInputs = [ coreutils ];
  text = builtins.readFile ./03B.sh;
}

