FROM ubuntu:18.04
LABEL maintainer="Andrew Champion <andrew.champion@gmail.com>, Tom Kazimiers <tom@voodoo-arts.net>"

# For building the image, let dpkg/apt know that we install and configure
# non-interactively.
ARG DEBIAN_FRONTEND=noninteractive

# Install dependencies. Even though this image doesn't run its own Postgres
# instance, make sure we install the upstream version to match the manual (and
# make building images on top of this one easier).
RUN apt-get update -y \
    && apt-get install -y apt-utils gawk software-properties-common wget ca-certificates gnupg2 \
    && add-apt-repository ppa:deadsnakes/ppa \
    && add-apt-repository -y ppa:nginx/stable \
    && apt-get update -y \
    && apt-get install -y python3.7 python3.7-dev git python-pip nginx supervisor

RUN mkdir -p ~/.gnupg && echo "disable-ipv6" >> ~/.gnupg/dirmngr.conf \
    # && apt-key adv --keyserver hkp://p80.pool.sks-keyservers.net:80 --recv-keys B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8 \
    && wget -q -O - https://postgresql.org/media/keys/ACCC4CF8.asc | apt-key add - \
    && add-apt-repository "deb http://apt.postgresql.org/pub/repos/apt/ bionic-pgdg main" \
    # && echo "deb http://apt.postgresql.org/pub/repos/apt/ $(lsb_release -cs)-pgdg main" > /etc/sources.list.d/pgdg.list \
    && rm -rf /var/lib/apt/lists/*

ADD packagelist-ubuntu-18.04-apt.txt /home/
RUN apt-get update -y  \
    && xargs apt-get install -y < /home/packagelist-ubuntu-18.04-apt.txt \
    && rm -rf /var/lib/apt/lists/*
ADD django/requirements.txt /home/django/
ENV WORKON_HOME /opt/virtualenvs
RUN mkdir -p /opt/virtualenvs \
    && /bin/bash -c "source /usr/share/virtualenvwrapper/virtualenvwrapper.sh \
    && mkvirtualenv catmaid -p /usr/bin/python3.7 \
    && workon catmaid \
    && pip install -U pip setuptools \
    && pip install -r /home/django/requirements.txt"

ADD . /home/

# Add Git commit build information to container by copying the Git repo (.git
# folder) into the container to run "git describe" and pipe its result in the
# file /home/git-version. After this is done, the repo is removed again from the
# container. We expect the environment to have a full git history, including
# tags. For DockerHub this is ensured with a post_checkout hook.
COPY .git /home/.git
RUN cd /home/ && git describe > /home/git-version && rm -r /home/.git

# uWSGI setup
RUN /bin/bash -c "source /usr/share/virtualenvwrapper/virtualenvwrapper.sh \
    && workon catmaid \
    && pip install uwsgi" \
    && ln -s /home/scripts/docker/supervisor-catmaid.conf /etc/supervisor/conf.d/ \
    && chmod +x /home/scripts/docker/start-catmaid.sh \
    && chmod +x /home/scripts/docker/catmaid-entry.sh

# Fix AUFS bug that breaks PostgreSQL
# See: https://github.com/docker/docker/issues/783
# Solution: https://github.com/moby/moby/issues/783#issuecomment-56013588
RUN mkdir /etc/ssl/private-copy; \
    mv /etc/ssl/private/* /etc/ssl/private-copy/; \
    rm -r /etc/ssl/private; \
    mv /etc/ssl/private-copy /etc/ssl/private; \
    chmod -R 0700 /etc/ssl/private; \
    chown -R postgres /etc/ssl/private

ENTRYPOINT ["/home/scripts/docker/catmaid-entry.sh"]

EXPOSE 8000
WORKDIR /home/django/projects/
CMD ["platform"]
