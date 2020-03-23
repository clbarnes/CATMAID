#!/bin/bash
set -e
set -x

DB_NAME=${DB_NAME:-"catmaid"}
DB_USER=${DB_USER:-"catmaid_user"}
DB_PASSWORD=${DB_PASSWORD:-"p4ssw0rd"}
if [ -f "$HOME/timezone" ]; then
    DEFAULT_TZ=$(cat $HOME/timezone)
else
    DEFAULT_TZ="America/New_York"
fi
TIMEZONE=${TIMEZONE:-$DEFAULT_TZ}

mkdir -p ~/data

echo "Making postgres accessible from host"
# TODO: make idempotent
PG_CONF_DIR="/etc/postgresql/11/main"
# https://gist.github.com/carymrobbins/39b75df64a1201407c80
sudo sed -i -e "s/#listen_addresses = 'localhost'/listen_addresses = '*'/" $PG_CONF_DIR/postgresql.conf
HBA_PATH="$PG_CONF_DIR/pg_hba.conf"
echo "Allowing postgres to accept password connections"
echo -e "local $DB_NAME $DB_USER md5" > ~/tmp.txt
echo -e "host $DB_NAME $DB_USER 0.0.0.0/0 md5" >> ~/tmp.txt
sudo cat $HBA_PATH >> ~/tmp.txt
sudo mv ~/tmp.txt $HBA_PATH
sudo systemctl restart postgresql

cd /CATMAID

echo "Creating CATMAID user"
scripts/createuser.sh $DB_NAME $DB_USER $DB_PASSWORD | sudo -u postgres psql

cd django
if [ ! -f projects/mysite/settings.py ]; then
    echo "Configuring CATMAID"
    cp configuration.py.example configuration.py

    sed -i -e "s?^\(abs_catmaid_path = \).*?\1'/CATMAID'?g" configuration.py
    sed -i -e "s?^\(abs_virtualenv_python_library_path = \).*?\1'/home/vagrant/catmaid-env/lib/python3.6/site-packages'?g" configuration.py

    sed -i -e "s?^\(catmaid_database_name = \).*?\1'$DB_NAME'?g" configuration.py
    sed -i -e "s?^\(catmaid_database_username = \).*?\1'$DB_USER'?g" configuration.py
    sed -i -e "s?^\(catmaid_database_password = \).*?\1'$DB_PASSWORD'?g" configuration.py

    sed -i -e "s?^\(catmaid_writable_path = \).*?\1'/home/vagrant/data'?g" configuration.py

    sed -i -e "s?^\(catmaid_timezone = \).*?\1'$TIMEZONE'?g" configuration.py
    sed -i -e "s?^\(catmaid_servername = \).*?\1'localhost'?g" configuration.py

    TOOLS="[\"tagging\", \"textlabel\", \"tracing\", \"ontology\", \"roi\"]"

    sed -i -e "s?^\(catmaid_default_enabled_tools = \).*?\1$TOOLS?g" configuration.py

    python create_configuration.py
    sed -i -e "s?^\(ALLOWED_HOSTS = \).*?\1['*']?g" projects/mysite/settings.py
    sed -i -e "s?^\(DEBUG = \).*?\1True?g" projects/mysite/settings.py
    # Enable static file serving without DEBUG = True
    echo "SERVE_STATIC = True" >> projects/mysite/settings.py
    #echo "PIPELINE['PIPELINE_ENABLED'] = False" >> projects/mysite/settings.py
    # Show full front-end errors by default
    echo "EXPAND_FRONTEND_ERRORS = True" >> projects/mysite/settings.py

    # cat projects/mysite/settings.py
else
    echo "django/projects/mysite/settings.py exists: skipping configuration"
fi

cd projects
./manage.py migrate
./manage.py collectstatic -l

echo "\n\nCreating CATMAID superuser account\n"
./manage.py createsuperuser
./manage.py catmaid_insert_example_projects --user=1
