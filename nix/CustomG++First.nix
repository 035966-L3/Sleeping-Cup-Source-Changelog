with import <nixpkgs> {};
writeShellApplication
{
  name = "CustomG++First";
  text = builtins.readFile ./CustomG++First.sh;
}
