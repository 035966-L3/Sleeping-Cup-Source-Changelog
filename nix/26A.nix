with import <nixpkgs> {};
writeShellApplication {
  name = "26A";
  runtimeInputs = [ coreutils ];
  text = builtins.readFile ./26A.sh;
}

